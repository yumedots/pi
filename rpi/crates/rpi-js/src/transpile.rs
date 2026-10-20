//! TypeScript to JavaScript, and ES modules to CommonJS.
//!
//! The extension host runs in V8 without a module loader, so an extension's
//! TypeScript is stripped of its types and its module syntax is rewritten into
//! `require` calls before it is evaluated.

use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::ast::{
	BindingPattern, Declaration, ImportDeclarationSpecifier, ModuleExportName, PropertyKey, Statement,
};
use oxc::codegen::Codegen;
use oxc::parser::Parser;
use oxc::semantic::SemanticBuilder;
use oxc::span::{GetSpan, SourceType};
use oxc::transformer::{TransformOptions, Transformer};

/// Turns TypeScript into JavaScript that the embedded runtime can evaluate.
pub fn transpile(source: &str, path: &Path) -> Result<String, String> {
	let javascript = strip_types(source, path)?;
	let javascript = replace_import_meta(&javascript, path)?;
	to_commonjs(&javascript)
}

/// Rewrite `import.meta` into the object the evaluator provides.
///
/// The extension host evaluates an extension's module as a script, and
/// `import.meta` is a syntax error outside a module. The original's loader
/// runs the module as a module, so an extension that reads its own URL works
/// there and not here.
fn replace_import_meta(javascript: &str, _path: &Path) -> Result<String, String> {
	if !javascript.contains("import.meta") {
		return Ok(javascript.to_string());
	}
	let mut out = String::with_capacity(javascript.len());
	let bytes = javascript.as_bytes();
	let mut index = 0;
	while index < bytes.len() {
		let byte = bytes[index];
		match byte {
			// A string or a template: copy it as it is.
			b'"' | b'`' | b'\'' => {
				let quote = byte;
				let start = index;
				index += 1;
				while index < bytes.len() {
					if bytes[index] == b'\\' {
						index += 2;
						continue;
					}
					if bytes[index] == quote {
						index += 1;
						break;
					}
					index += 1;
				}
				out.push_str(&javascript[start..index]);
			}
			// A comment: copy it as it is.
			b'/' if index + 1 < bytes.len() && bytes[index + 1] == b'/' => {
				let start = index;
				while index < bytes.len() && bytes[index] != b'\n' {
					index += 1;
				}
				out.push_str(&javascript[start..index]);
			}
			b'/' if index + 1 < bytes.len() && bytes[index + 1] == b'*' => {
				let start = index;
				index += 2;
				while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/') {
					index += 1;
				}
				index = (index + 2).min(bytes.len());
				out.push_str(&javascript[start..index]);
			}
			_ => {
				if javascript[index..].starts_with("import.meta") {
					out.push_str("__piImportMeta");
					index += "import.meta".len();
					continue;
				}
				let width = utf8_width(byte);
				out.push_str(&javascript[index..index + width]);
				index += width;
			}
		}
	}
	Ok(out)
}

/// The width of the UTF-8 character that starts with this byte.
fn utf8_width(byte: u8) -> usize {
	match byte {
		0x00..=0x7f => 1,
		0xc0..=0xdf => 2,
		0xe0..=0xef => 3,
		_ => 4,
	}
}

fn strip_types(source: &str, path: &Path) -> Result<String, String> {
	let allocator = Allocator::default();
	let source_type = SourceType::from_path(path).unwrap_or_else(|_| SourceType::ts());
	let parsed = Parser::new(&allocator, source, source_type).parse();
	if !parsed.diagnostics.is_empty() {
		return Err(diagnostics(&parsed.diagnostics));
	}
	let mut program = parsed.program;
	let semantic = SemanticBuilder::new().build(&program);
	if !semantic.diagnostics.is_empty() {
		return Err(diagnostics(&semantic.diagnostics));
	}
	let scoping = semantic.semantic.into_scoping();
	let options = TransformOptions::default();
	let transformer = Transformer::new(&allocator, path, &options);
	let result = transformer.build_with_scoping(scoping, &mut program);
	if result.diagnostics.has_errors() {
		return Err(diagnostics(&result.diagnostics));
	}
	Ok(Codegen::new().build(&program).code)
}

fn diagnostics(errors: &oxc::diagnostics::Diagnostics) -> String {
	errors
		.iter()
		.map(|error| error.message.to_string())
		.collect::<Vec<_>>()
		.join("; ")
}

fn to_commonjs(javascript: &str) -> Result<String, String> {
	let allocator = Allocator::default();
	let parsed = Parser::new(&allocator, javascript, SourceType::mjs()).parse();
	if !parsed.diagnostics.is_empty() {
		return Err(diagnostics(&parsed.diagnostics));
	}
	let mut counter = 0usize;
	let mut out = String::with_capacity(javascript.len());
	let mut cursor = 0usize;
	for statement in &parsed.program.body {
		let Some(replacement) = replacement(statement, javascript, &mut counter) else {
			continue;
		};
		let span = statement.span();
		out.push_str(&javascript[cursor..span.start as usize]);
		out.push_str(&replacement);
		cursor = span.end as usize;
	}
	out.push_str(&javascript[cursor..]);
	Ok(out)
}

fn replacement(statement: &Statement, javascript: &str, counter: &mut usize) -> Option<String> {
	match statement {
		Statement::ImportDeclaration(declaration) => Some(import_replacement(declaration, counter)),
		Statement::ExportDeclaration(declaration) => Some(export_declaration_replacement(declaration, javascript)),
		Statement::ExportNamedDeclaration(declaration) => Some(export_named_replacement(declaration)),
		Statement::ExportFromDeclaration(declaration) => Some(export_from_replacement(declaration, counter)),
		Statement::ExportDefaultDeclaration(declaration) => Some(export_default_replacement(declaration, javascript)),
		Statement::ExportAllDeclaration(declaration) => Some(export_all_replacement(declaration, counter)),
		_ => None,
	}
}

fn import_replacement(declaration: &oxc::ast::ast::ImportDeclaration, counter: &mut usize) -> String {
	let source = declaration.source.value.as_str().unwrap_or_default();
	let mut default_binding = None;
	let mut namespace_binding = None;
	let mut named: Vec<(String, String)> = Vec::new();
	if let Some(specifiers) = &declaration.specifiers {
		for specifier in specifiers {
			match specifier {
				ImportDeclarationSpecifier::ImportDefaultSpecifier(specifier) => {
					default_binding = Some(specifier.local.name.as_str().to_string());
				}
				ImportDeclarationSpecifier::ImportNamespaceSpecifier(specifier) => {
					namespace_binding = Some(specifier.local.name.as_str().to_string());
				}
				ImportDeclarationSpecifier::ImportSpecifier(specifier) => {
					named.push((export_name(&specifier.imported), specifier.local.name.as_str().to_string()));
				}
			}
		}
	}
	let module = format!("__pi_module_{}", *counter);
	*counter += 1;
	let mut out = format!("const {module} = require({});\n", quote(source));
	if let Some(binding) = default_binding {
		out.push_str(&format!(
			"const {binding} = {module}.default !== undefined ? {module}.default : {module};\n"
		));
	}
	if let Some(binding) = namespace_binding {
		out.push_str(&format!("const {binding} = {module};\n"));
	}
	if !named.is_empty() {
		let bindings = named
			.iter()
			.map(|(imported, local)| {
				if imported == local {
					imported.clone()
				} else {
					format!("{imported}: {local}")
				}
			})
			.collect::<Vec<_>>()
			.join(", ");
		out.push_str(&format!("const {{ {bindings} }} = {module};\n"));
	}
	out
}

fn export_declaration_replacement(
	declaration: &oxc::ast::ast::ExportDeclaration,
	javascript: &str,
) -> String {
	let inner = &declaration.declaration;
	let span = inner.span();
	let mut out = javascript[span.start as usize..span.end as usize].to_string();
	for name in exported_names(inner) {
		out.push_str(&format!("\n__piExports.{name} = {name};"));
	}
	out
}

fn export_named_replacement(declaration: &oxc::ast::ast::ExportNamedDeclaration) -> String {
	let mut out = String::new();
	for specifier in &declaration.specifiers {
		let local = export_name(&specifier.local);
		let exported = export_name(&specifier.exported);
		out.push_str(&format!("\n__piExports.{exported} = {local};"));
	}
	out
}

fn export_from_replacement(
	declaration: &oxc::ast::ast::ExportFromDeclaration,
	counter: &mut usize,
) -> String {
	let source = declaration.source.value.as_str().unwrap_or_default();
	let module = format!("__pi_module_{}", *counter);
	*counter += 1;
	let mut out = format!("const {module} = require({});\n", quote(source));
	for specifier in &declaration.specifiers {
		let local = export_name(&specifier.local);
		let exported = export_name(&specifier.exported);
		out.push_str(&format!("\n__piExports.{exported} = {module}.{local};"));
	}
	out
}

fn export_default_replacement(
	declaration: &oxc::ast::ast::ExportDefaultDeclaration,
	javascript: &str,
) -> String {
	let span = declaration.span();
	let text = &javascript[span.start as usize..span.end as usize];
	let value = text.strip_prefix("export default").unwrap_or(text);
	format!("__piExports.default ={value}")
}

fn export_all_replacement(declaration: &oxc::ast::ast::ExportAllDeclaration, counter: &mut usize) -> String {
	let source = declaration.source.value.as_str().unwrap_or_default();
	if let Some(exported) = &declaration.exported {
		return format!("__piExports.{} = require({});", export_name(exported), quote(source));
	}
	let module = format!("__pi_module_{}", *counter);
	*counter += 1;
	format!(
		"const {module} = require({});\nfor (const __pi_key of Object.keys({module})) {{ if (__pi_key !== \"default\") __piExports[__pi_key] = {module}[__pi_key]; }}",
		quote(source)
	)
}

fn exported_names(declaration: &Declaration) -> Vec<String> {
	match declaration {
		Declaration::VariableDeclaration(declaration) => {
			let mut names = Vec::new();
			for declarator in &declaration.declarations {
				names.extend(binding_names(&declarator.id));
			}
			names
		}
		Declaration::FunctionDeclaration(declaration) => declaration
			.id
			.as_ref()
			.map(|id| vec![id.name.as_str().to_string()])
			.unwrap_or_default(),
		Declaration::ClassDeclaration(declaration) => declaration
			.id
			.as_ref()
			.map(|id| vec![id.name.as_str().to_string()])
			.unwrap_or_default(),
		_ => Vec::new(),
	}
}

fn binding_names(pattern: &BindingPattern) -> Vec<String> {
	match pattern {
		BindingPattern::BindingIdentifier(identifier) => vec![identifier.name.as_str().to_string()],
		BindingPattern::AssignmentPattern(pattern) => binding_names(&pattern.left),
		BindingPattern::ObjectPattern(pattern) => pattern
			.properties
			.iter()
			.filter_map(|property| match &property.key {
				PropertyKey::StaticIdentifier(identifier) => Some(identifier.name.as_str().to_string()),
				PropertyKey::StringLiteral(literal) => Some(literal.value.as_str().unwrap_or_default().to_string()),
				_ => None,
			})
			.collect(),
		BindingPattern::ArrayPattern(pattern) => pattern
			.elements
			.iter()
			.flatten()
			.flat_map(binding_names)
			.collect(),
	}
}

fn export_name(name: &ModuleExportName) -> String {
	match name {
		ModuleExportName::IdentifierName(identifier) => identifier.name.as_str().to_string(),
		ModuleExportName::IdentifierReference(identifier) => identifier.name.as_str().to_string(),
		ModuleExportName::StringLiteral(literal) => literal.value.as_str().unwrap_or_default().to_string(),
	}
}

fn quote(value: &str) -> String {
	let mut out = String::with_capacity(value.len() + 2);
	out.push('"');
	for character in value.chars() {
		match character {
			'"' => out.push_str("\\\""),
			'\\' => out.push_str("\\\\"),
			'\n' => out.push_str("\\n"),
			'\r' => out.push_str("\\r"),
			'\t' => out.push_str("\\t"),
			other => out.push(other),
		}
	}
	out.push('"');
	out
}

#[cfg(test)]
mod tests {
	use std::path::Path;

	fn transpile(source: &str) -> String {
		super::transpile(source, Path::new("extension.ts")).expect("transpile")
	}

	#[test]
	fn strips_types() {
		let output = transpile("const value: number = 1;\nexport default value;\n");
		assert!(!output.contains(": number"), "{output}");
		assert!(output.contains("const value = 1"), "{output}");
	}

	#[test]
	fn rewrites_imports() {
		let output = transpile(
			"import { Type } from \"typebox\";\nimport type { Foo } from \"x\";\nconst schema = Type.String();\n",
		);
		assert!(output.contains("require(\"typebox\")"), "{output}");
		assert!(output.contains("{ Type }"), "{output}");
		assert!(!output.contains("Foo"), "{output}");
	}

	#[test]
	fn rewrites_exports() {
		let output = transpile("export const answer = 42;\nexport default function () { return 1; }\n");
		assert!(output.contains("__piExports.answer = answer"), "{output}");
		assert!(output.contains("__piExports.default = function"), "{output}");
	}
}
