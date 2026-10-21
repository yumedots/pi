"use strict";
(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));


  var require_node_fs = __commonJS({
    "rpi/crates/rpi-js/js/shims/node-fs.ts"(exports, module) {
      "use strict";
      var call = (op, args) => {
        const bridge = globalThis.__piHostCall;
        const response = JSON.parse(bridge(op, JSON.stringify(args ?? {})));
        if (!response.ok) {
          throw new Error(response.error ?? "the host refused the call");
        }
        return response.value;
      };
      var readFileSync = (path2) => call("fs.readFile", { path: path2 });
      var writeFileSync = (path2, content) => {
        call("fs.writeFile", { path: path2, content });
      };
      var existsSync = (path2) => call("fs.exists", { path: path2 });
      var readdirSync = (path2) => call("fs.readdir", { path: path2 });
      var statSync = (path2) => call("fs.stat", { path: path2 });
      var mkdirSync = (path2) => {
        call("fs.mkdir", { path: path2 });
      };
      var unlinkSync = (path2) => {
        call("fs.unlink", { path: path2 });
      };
      var openSync = (path2, _flags) => {
        call("fs.open", { path: path2, flags: _flags });
        return 0;
      };
      var accessSync = (path2) => call("fs.access", { path: path2 });
      var realpathSync = (path2) => call("fs.realpath", { path: path2 });
      var renameSync = (from, to) => {
        call("fs.rename", { from, to });
      };
      var copyFileSync = (from, to) => {
        call("fs.copyFile", { from, to });
      };
      var appendFileSync = (path2, content) => {
        call("fs.appendFile", { path: path2, content });
      };
      var closeSync = (_descriptor) => void 0;
      var chmodSync = (path2, mode) => {
        call("fs.chmod", { path: path2, mode });
      };
      var watch = (_path, _listener) => () => void 0;
      var createReadStream = (path2) => {
        const content = readFileSync(path2);
        let position = 0;
        return {
          read: () => {
            if (position >= content.length) return null;
            const chunk = content.slice(position);
            position = content.length;
            return chunk;
          },
          on: () => void 0,
          close: () => void 0
        };
      };
      var globSync = (_pattern) => {
        throw new Error("fs.globSync is not available in the embedded extension host");
      };
      var createWriteStream = (path2) => {
        let content = "";
        return {
          write: (chunk) => {
            content += chunk;
            return true;
          },
          end: () => {
            writeFileSync(path2, content);
          },
          on: () => void 0
        };
      };
      var mkdtempSync = (prefix) => call("fs.mkdtemp", { prefix });
      var unwatchFile = (_path) => void 0;
      var watchFile = (_path, _listener) => () => void 0;
      var lstatSync = (path2) => statSync(path2);
      var fstatSync = (descriptor) => statSync(String(descriptor));
      var readlinkSync = (path2) => path2;
      var symlinkSync = (_target, _path) => void 0;
      var rmdirSync = (path2) => {
        call("fs.rmdir", { path: path2 });
      };
      var truncateSync = (path2, length) => {
        call("fs.truncate", { path: path2, length });
      };
      var chownSync = (_path, _uid, _gid) => void 0;
      var utimesSync = (_path, _atime, _mtime) => void 0;
      var writeSync = (_descriptor, content) => content.length;
      var readSync = (descriptor, _buffer, _offset, _length, _position) => {
        void descriptor;
        return 0;
      };
      var rmSync = (path2, options) => {
        if (options?.force && !existsSync(path2)) return;
        unlinkSync(path2);
      };
      var constants2 = {
        F_OK: 0,
        R_OK: 4,
        W_OK: 2,
        X_OK: 1,
        O_RDONLY: 0,
        O_WRONLY: 1,
        O_RDWR: 2,
        O_CREAT: 64,
        O_TRUNC: 512,
        O_APPEND: 1024
      };
      var readFile = async (path2) => readFileSync(path2);
      var writeFile = async (path2, content) => {
        writeFileSync(path2, content);
      };
      var exists = async (path2) => existsSync(path2);
      var readdir = async (path2) => readdirSync(path2);
      var stat = async (path2) => statSync(path2);
      var mkdir = async (path2) => {
        mkdirSync(path2);
      };
      var unlink = async (path2) => {
        unlinkSync(path2);
      };
      var access = async (path2) => accessSync(path2);
      var realpath = async (path2) => realpathSync(path2);
      var rename = async (from, to) => {
        renameSync(from, to);
      };
      var copyFile = async (from, to) => {
        copyFileSync(from, to);
      };
      var appendFile = async (path2, content) => {
        appendFileSync(path2, content);
      };
      var open2 = async (path2, flags) => {
        openSync(path2, flags);
        return {
          read: async () => readFileSync(path2),
          close: async () => void 0
        };
      };
      var mkdtemp = async (prefix) => mkdtempSync(prefix);
      var promises2 = {
        readFile,
        writeFile,
        exists,
        readdir,
        stat,
        mkdir,
        unlink,
        open: open2,
        access,
        realpath,
        rename,
        copyFile,
        appendFile,
        mkdtemp
      };
      var fs = {
        readFileSync,
        writeFileSync,
        existsSync,
        readdirSync,
        statSync,
        mkdirSync,
        unlinkSync,
        openSync,
        accessSync,
        realpathSync,
        renameSync,
        copyFileSync,
        appendFileSync,
        closeSync,
        chmodSync,
        watch,
        createReadStream,
        globSync,
        createWriteStream,
        mkdtempSync,
        unwatchFile,
        watchFile,
        lstatSync,
        fstatSync,
        readlinkSync,
        symlinkSync,
        rmdirSync,
        truncateSync,
        chownSync,
        utimesSync,
        writeSync,
        readSync,
        rmSync,
        constants: constants2,
        readFile,
        writeFile,
        exists,
        readdir,
        stat,
        mkdir,
        unlink,
        access,
        realpath,
        rename,
        copyFile,
        appendFile,
        open: open2,
        mkdtemp,
        promises: promises2
      };
      module.exports = fs;
    }
  });


  var require_node_fs_promises = __commonJS({
    "rpi/crates/rpi-js/js/shims/node-fs-promises.ts"(exports, module) {
      "use strict";
      var import_node_fs = __toESM(require_node_fs(), 1);
      var { promises: promises2 } = import_node_fs.default;
      var readFile = promises2.readFile;
      var writeFile = promises2.writeFile;
      var exists = promises2.exists;
      var readdir = promises2.readdir;
      var stat = promises2.stat;
      var open2 = promises2.open;
      var mkdir = promises2.mkdir;
      var rm = promises2.rm;
      var unlink = promises2.unlink;
      var rename = promises2.rename;
      var copyFile = promises2.copyFile;
      var access = promises2.access;
      var realpath = promises2.realpath;
      var appendFile = promises2.appendFile;
      var mkdtemp = promises2.mkdtemp;
      var fsPromises = {
        readFile,
        writeFile,
        exists,
        readdir,
        stat,
        open: open2,
        mkdir,
        rm,
        unlink,
        rename,
        copyFile,
        access,
        realpath,
        appendFile,
        mkdtemp
      };
      module.exports = fsPromises;
    }
  });


  var types_exports = {};
  __export(types_exports, {
    defineTool: () => defineTool,
    isBashToolResult: () => isBashToolResult,
    isEditToolResult: () => isEditToolResult,
    isFindToolResult: () => isFindToolResult,
    isGrepToolResult: () => isGrepToolResult,
    isLsToolResult: () => isLsToolResult,
    isPowerShellToolResult: () => isPowerShellToolResult,
    isReadToolResult: () => isReadToolResult,
    isToolCallEventType: () => isToolCallEventType,
    isWriteToolResult: () => isWriteToolResult
  });
  function defineTool(tool) {
    return tool;
  }
  function isBashToolResult(e) {
    return e.toolName === "bash";
  }
  function isPowerShellToolResult(e) {
    return e.toolName === "powershell";
  }
  function isReadToolResult(e) {
    return e.toolName === "read";
  }
  function isEditToolResult(e) {
    return e.toolName === "edit";
  }
  function isWriteToolResult(e) {
    return e.toolName === "write";
  }
  function isGrepToolResult(e) {
    return e.toolName === "grep";
  }
  function isFindToolResult(e) {
    return e.toolName === "find";
  }
  function isLsToolResult(e) {
    return e.toolName === "ls";
  }
  function isToolCallEventType(toolName, event) {
    return event.toolName === toolName;
  }


  var pi_agent_core_exports = {};
  __export(pi_agent_core_exports, {
    AGENT_RUNTIME_AVAILABLE: () => AGENT_RUNTIME_AVAILABLE,
    default: () => pi_agent_core_default
  });
  var AGENT_RUNTIME_AVAILABLE = false;
  var pi_agent_core_default = { AGENT_RUNTIME_AVAILABLE };


  var pi_ai_exports = {};
  __export(pi_ai_exports, {
    Type: () => typebox_exports
  });


  var build_exports = {};
  __export(build_exports, {
    AddImmutable: () => AddImmutable,
    AddImmutableDeferred: () => AddImmutableDeferred,
    AddOptional: () => AddOptional,
    AddOptionalDeferred: () => AddOptionalDeferred,
    AddReadonly: () => AddReadonly,
    AddReadonlyDeferred: () => AddReadonlyDeferred,
    Any: () => Any,
    Array: () => _Array_,
    ArrayOptions: () => ArrayOptions,
    BigInt: () => BigInt2,
    BigIntPattern: () => BigIntPattern,
    Boolean: () => Boolean2,
    Broaden: () => Broaden,
    Call: () => Call2,
    CallConstruct: () => CallConstruct,
    CanComposite: () => CanComposite,
    Capitalize: () => Capitalize,
    CapitalizeAction: () => CapitalizeAction,
    CapitalizeDeferred: () => CapitalizeDeferred,
    CapitalizeInstantiate: () => CapitalizeInstantiate,
    Codec: () => Codec,
    CollapseToObject: () => CollapseToObject,
    Compare: () => Compare,
    CompareResultDisjoint: () => CompareResultDisjoint,
    CompareResultEqual: () => CompareResultEqual,
    CompareResultLeftInside: () => CompareResultLeftInside,
    CompareResultRightInside: () => CompareResultRightInside,
    Composite: () => Composite,
    Conditional: () => Conditional,
    ConditionalAction: () => ConditionalAction,
    ConditionalDeferred: () => ConditionalDeferred,
    ConditionalInstantiate: () => ConditionalInstantiate,
    Constructor: () => Constructor,
    ConstructorOptions: () => ConstructorOptions,
    ConstructorParameters: () => ConstructorParameters,
    ConstructorParametersAction: () => ConstructorParametersAction,
    ConstructorParametersDeferred: () => ConstructorParametersDeferred,
    ConstructorParametersInstantiate: () => ConstructorParametersInstantiate,
    ConvertToIntegerKey: () => ConvertToIntegerKey,
    Cyclic: () => Cyclic,
    CyclicCandidates: () => CyclicCandidates,
    CyclicCheck: () => CyclicCheck,
    CyclicDependencies: () => CyclicDependencies,
    CyclicExtends: () => CyclicExtends,
    CyclicOptions: () => CyclicOptions,
    CyclicTarget: () => CyclicTarget,
    Decode: () => Decode,
    DecodeBuilder: () => DecodeBuilder,
    Deferred: () => Deferred,
    Dependent: () => Dependent,
    DependentOptions: () => DependentOptions,
    Distribute: () => Distribute,
    Encode: () => Encode,
    EncodeBuilder: () => EncodeBuilder,
    Enum: () => Enum,
    Evaluate: () => Evaluate2,
    EvaluateAction: () => EvaluateAction,
    EvaluateDeferred: () => EvaluateDeferred,
    EvaluateDependent: () => EvaluateDependent,
    EvaluateEnum: () => EvaluateEnum,
    EvaluateInstantiate: () => EvaluateInstantiate,
    EvaluateIntersect: () => EvaluateIntersect,
    EvaluateTemplateLiteral: () => EvaluateTemplateLiteral,
    EvaluateType: () => EvaluateType,
    EvaluateUnion: () => EvaluateUnion,
    EvaluateUnionFast: () => EvaluateUnionFast,
    Exclude: () => Exclude,
    ExcludeAction: () => ExcludeAction,
    ExcludeDeferred: () => ExcludeDeferred,
    ExcludeInstantiate: () => ExcludeInstantiate,
    Extends: () => Extends,
    ExtendsResult: () => result_exports,
    Extract: () => Extract,
    ExtractAction: () => ExtractAction,
    ExtractDeferred: () => ExtractDeferred,
    ExtractInstantiate: () => ExtractInstantiate,
    Flatten: () => Flatten,
    Function: () => _Function_,
    FunctionOptions: () => FunctionOptions,
    Generic: () => Generic,
    Identifier: () => Identifier,
    Immutable: () => Immutable,
    Index: () => Index,
    IndexAction: () => IndexAction,
    IndexDeferred: () => IndexDeferred,
    IndexInstantiate: () => IndexInstantiate,
    Infer: () => Infer,
    InstanceType: () => InstanceType,
    InstanceTypeAction: () => InstanceTypeAction,
    InstanceTypeDeferred: () => InstanceTypeDeferred,
    InstanceTypeInstantiate: () => InstanceTypeInstantiate,
    Instantiate: () => Instantiate,
    InstantiateCyclic: () => InstantiateCyclic,
    Integer: () => Integer,
    IntegerKey: () => IntegerKey,
    IntegerPattern: () => IntegerPattern,
    Interface: () => Interface,
    InterfaceAction: () => InterfaceAction,
    InterfaceDeferred: () => InterfaceDeferred,
    InterfaceInstantiate: () => InterfaceInstantiate,
    Intersect: () => Intersect,
    IntersectOptions: () => IntersectOptions,
    InvalidLiteralValue: () => InvalidLiteralValue,
    IsAny: () => IsAny,
    IsArray: () => IsArray3,
    IsBigInt: () => IsBigInt3,
    IsBoolean: () => IsBoolean4,
    IsCall: () => IsCall,
    IsCodec: () => IsCodec,
    IsConstructor: () => IsConstructor3,
    IsCyclic: () => IsCyclic,
    IsDeferred: () => IsDeferred,
    IsDependent: () => IsDependent,
    IsEnum: () => IsEnum,
    IsEnumValue: () => IsEnumValue,
    IsFunction: () => IsFunction3,
    IsGeneric: () => IsGeneric,
    IsIdentifier: () => IsIdentifier2,
    IsImmutable: () => IsImmutable,
    IsInfer: () => IsInfer,
    IsInteger: () => IsInteger3,
    IsInterfaceDeferred: () => IsInterfaceDeferred,
    IsIntersect: () => IsIntersect,
    IsKind: () => IsKind,
    IsLiteral: () => IsLiteral,
    IsLiteralBigInt: () => IsLiteralBigInt,
    IsLiteralBoolean: () => IsLiteralBoolean,
    IsLiteralNumber: () => IsLiteralNumber,
    IsLiteralString: () => IsLiteralString,
    IsLiteralValue: () => IsLiteralValue,
    IsNever: () => IsNever,
    IsNull: () => IsNull3,
    IsNumber: () => IsNumber4,
    IsObject: () => IsObject3,
    IsOptional: () => IsOptional,
    IsParameter: () => IsParameter,
    IsReadonly: () => IsReadonly,
    IsRecord: () => IsRecord,
    IsRef: () => IsRef,
    IsRefine: () => IsRefine,
    IsRefinement: () => IsRefinement,
    IsRest: () => IsRest,
    IsSchema: () => IsSchema,
    IsString: () => IsString4,
    IsSymbol: () => IsSymbol3,
    IsTemplateLiteral: () => IsTemplateLiteral,
    IsTemplateLiteralDeferred: () => IsTemplateLiteralDeferred,
    IsTemplateLiteralFinite: () => IsTemplateLiteralFinite,
    IsTemplateLiteralPattern: () => IsTemplateLiteralPattern,
    IsThis: () => IsThis,
    IsTuple: () => IsTuple,
    IsTypeScriptEnumLike: () => IsTypeScriptEnumLike,
    IsUndefined: () => IsUndefined3,
    IsUnion: () => IsUnion,
    IsUnknown: () => IsUnknown,
    IsUnsafe: () => IsUnsafe,
    IsVoid: () => IsVoid,
    KeyOf: () => KeyOf2,
    KeyOfAction: () => KeyOfAction,
    KeyOfDeferred: () => KeyOfDeferred,
    KeyOfInstantiate: () => KeyOfInstantiate,
    KeysToIndexer: () => KeysToIndexer,
    Literal: () => Literal,
    LiteralTypeName: () => LiteralTypeName,
    Lowercase: () => Lowercase,
    LowercaseAction: () => LowercaseAction,
    LowercaseDeferred: () => LowercaseDeferred,
    LowercaseInstantiate: () => LowercaseInstantiate,
    Mapped: () => Mapped,
    MappedAction: () => MappedAction,
    MappedDeferred: () => MappedDeferred,
    MappedInstantiate: () => MappedInstantiate,
    Module: () => Module2,
    ModuleDeferred: () => ModuleDeferred,
    ModuleInstantiate: () => ModuleInstantiate,
    Narrow: () => Narrow,
    Never: () => Never,
    NeverPattern: () => NeverPattern,
    NonNullable: () => NonNullable,
    NonNullableAction: () => NonNullableAction,
    NonNullableDeferred: () => NonNullableDeferred,
    NonNullableInstantiate: () => NonNullableInstantiate,
    Null: () => Null,
    Number: () => Number2,
    NumberKey: () => NumberKey,
    NumberPattern: () => NumberPattern,
    Object: () => _Object_,
    ObjectOptions: () => ObjectOptions,
    Omit: () => Omit,
    OmitAction: () => OmitAction,
    OmitDeferred: () => OmitDeferred,
    OmitInstantiate: () => OmitInstantiate,
    Optional: () => Optional,
    Parameter: () => Parameter,
    Parameters: () => Parameters,
    ParametersAction: () => ParametersAction,
    ParametersDeferred: () => ParametersDeferred,
    ParametersInstantiate: () => ParametersInstantiate,
    ParsePatternIntoTypes: () => ParsePatternIntoTypes,
    ParseTemplateIntoTypes: () => ParseTemplateIntoTypes,
    Partial: () => Partial,
    PartialAction: () => PartialAction,
    PartialDeferred: () => PartialDeferred,
    PartialInstantiate: () => PartialInstantiate,
    Pick: () => Pick,
    PickAction: () => PickAction,
    PickDeferred: () => PickDeferred,
    PickInstantiate: () => PickInstantiate,
    Priority: () => Priority,
    PropertyKeys: () => PropertyKeys,
    PropertyValues: () => PropertyValues,
    Readonly: () => Readonly,
    ReadonlyObject: () => ReadonlyObject,
    ReadonlyObjectAction: () => ReadonlyObjectAction,
    ReadonlyObjectDeferred: () => ReadonlyObjectDeferred,
    ReadonlyObjectInstantiate: () => ReadonlyObjectInstantiate,
    ReadonlyType: () => ReadonlyType,
    Record: () => Record,
    RecordAction: () => RecordAction,
    RecordDeferred: () => RecordDeferred,
    RecordFromPattern: () => RecordFromPattern,
    RecordInstantiate: () => RecordInstantiate,
    RecordKey: () => RecordKey,
    RecordOptions: () => RecordOptions,
    RecordPattern: () => RecordPattern,
    RecordPatternToType: () => RecordPatternToType,
    RecordValue: () => RecordValue,
    Ref: () => Ref,
    RefInstantiate: () => RefInstantiate,
    Refine: () => Refine,
    RefineAdd: () => RefineAdd,
    RemoveImmutable: () => RemoveImmutable,
    RemoveImmutableDeferred: () => RemoveImmutableDeferred,
    RemoveOptional: () => RemoveOptional,
    RemoveOptionalDeferred: () => RemoveOptionalDeferred,
    RemoveReadonly: () => RemoveReadonly,
    RemoveReadonlyDeferred: () => RemoveReadonlyDeferred,
    Required: () => Required,
    RequiredAction: () => RequiredAction,
    RequiredArray: () => RequiredArray,
    RequiredDeferred: () => RequiredDeferred,
    RequiredInstantiate: () => RequiredInstantiate,
    Rest: () => Rest,
    ReturnType: () => ReturnType,
    ReturnTypeAction: () => ReturnTypeAction,
    ReturnTypeDeferred: () => ReturnTypeDeferred,
    ReturnTypeInstantiate: () => ReturnTypeInstantiate,
    Script: () => Script2,
    String: () => String2,
    StringKey: () => StringKey,
    StringPattern: () => StringPattern,
    Symbol: () => Symbol2,
    TemplateLiteral: () => TemplateLiteral2,
    TemplateLiteralCreate: () => TemplateLiteralCreate,
    TemplateLiteralDecode: () => TemplateLiteralDecode,
    TemplateLiteralDecodeUnsafe: () => TemplateLiteralDecodeUnsafe,
    TemplateLiteralDeferred: () => TemplateLiteralDeferred,
    TemplateLiteralEncode: () => TemplateLiteralEncode,
    TemplateLiteralFromString: () => TemplateLiteralFromString,
    TemplateLiteralFromTypes: () => TemplateLiteralFromTypes,
    This: () => This,
    Tuple: () => Tuple,
    TupleOptions: () => TupleOptions,
    Type: () => typebox_exports,
    TypeScriptEnumToEnumValues: () => TypeScriptEnumToEnumValues,
    Uncapitalize: () => Uncapitalize,
    UncapitalizeAction: () => UncapitalizeAction,
    UncapitalizeDeferred: () => UncapitalizeDeferred,
    UncapitalizeInstantiate: () => UncapitalizeInstantiate,
    Undefined: () => Undefined,
    Union: () => Union,
    UnionOptions: () => UnionOptions,
    Unknown: () => Unknown,
    Unsafe: () => Unsafe,
    Uppercase: () => Uppercase,
    UppercaseAction: () => UppercaseAction,
    UppercaseDeferred: () => UppercaseDeferred,
    UppercaseInstantiate: () => UppercaseInstantiate,
    Void: () => Void,
    With: () => With2,
    WithAction: () => WithAction,
    WithDeferred: () => WithDeferred,
    WithInstantiate: () => WithInstantiate,
    _Array_: () => _Array_,
    _Function_: () => _Function_,
    _Object_: () => _Object_,
    default: () => build_default
  });


  var memory_exports = {};
  __export(memory_exports, {
    Assign: () => Assign,
    Clone: () => Clone,
    Create: () => Create,
    Discard: () => Discard,
    Metrics: () => Metrics,
    Update: () => Update
  });


  var Metrics = {
    assign: 0,
    create: 0,
    clone: 0,
    discard: 0,
    update: 0
  };


  var settings_exports = {};
  __export(settings_exports, {
    Get: () => Get,
    Reset: () => Reset,
    Set: () => Set2
  });


  var emit_exports = {};
  __export(emit_exports, {
    And: () => And,
    ArrayLiteral: () => ArrayLiteral,
    ArrowFunction: () => ArrowFunction,
    Call: () => Call,
    ConstDeclaration: () => ConstDeclaration,
    Constant: () => Constant,
    Counted: () => Counted2,
    Entries: () => Entries2,
    Every: () => Every2,
    HasPropertyKey: () => HasPropertyKey2,
    If: () => If,
    IsArray: () => IsArray2,
    IsBigInt: () => IsBigInt2,
    IsBoolean: () => IsBoolean2,
    IsConstructor: () => IsConstructor2,
    IsDeepEqual: () => IsDeepEqual2,
    IsEqual: () => IsEqual2,
    IsFunction: () => IsFunction2,
    IsGreaterEqualThan: () => IsGreaterEqualThan2,
    IsGreaterThan: () => IsGreaterThan2,
    IsInteger: () => IsInteger2,
    IsLessEqualThan: () => IsLessEqualThan2,
    IsLessThan: () => IsLessThan2,
    IsMaxLength: () => IsMaxLength3,
    IsMinLength: () => IsMinLength3,
    IsNull: () => IsNull2,
    IsNumber: () => IsNumber2,
    IsObject: () => IsObject2,
    IsObjectNotArray: () => IsObjectNotArray2,
    IsString: () => IsString2,
    IsSymbol: () => IsSymbol2,
    IsUndefined: () => IsUndefined2,
    Keys: () => Keys2,
    Member: () => Member,
    MultipleOf: () => MultipleOf,
    New: () => New,
    Not: () => Not,
    Or: () => Or,
    ReduceAnd: () => ReduceAnd,
    ReduceOr: () => ReduceOr,
    Return: () => Return,
    Some: () => Some2,
    SomeAll: () => SomeAll2,
    Statements: () => Statements,
    Ternary: () => Ternary
  });


  var guard_exports = {};
  __export(guard_exports, {
    Counted: () => Counted,
    Entries: () => Entries,
    EntriesRegExp: () => EntriesRegExp,
    Every: () => Every,
    EveryAll: () => EveryAll,
    GraphemeCount: () => GraphemeCount2,
    HasPropertyKey: () => HasPropertyKey,
    IsArray: () => IsArray,
    IsBigInt: () => IsBigInt,
    IsBoolean: () => IsBoolean,
    IsClassInstance: () => IsClassInstance,
    IsConstructor: () => IsConstructor,
    IsDeepEqual: () => IsDeepEqual,
    IsEqual: () => IsEqual,
    IsFunction: () => IsFunction,
    IsGreaterEqualThan: () => IsGreaterEqualThan,
    IsGreaterThan: () => IsGreaterThan,
    IsInteger: () => IsInteger,
    IsLessEqualThan: () => IsLessEqualThan,
    IsLessThan: () => IsLessThan,
    IsMaxLength: () => IsMaxLength2,
    IsMinLength: () => IsMinLength2,
    IsMultipleOf: () => IsMultipleOf,
    IsNull: () => IsNull,
    IsNumber: () => IsNumber,
    IsObject: () => IsObject,
    IsObjectNotArray: () => IsObjectNotArray,
    IsString: () => IsString,
    IsSymbol: () => IsSymbol,
    IsUndefined: () => IsUndefined,
    IsUnsafePropertyKey: () => IsUnsafePropertyKey,
    IsValueLike: () => IsValueLike,
    Keys: () => Keys,
    ShiftLeft: () => ShiftLeft,
    Some: () => Some,
    SomeAll: () => SomeAll,
    Symbols: () => Symbols,
    Values: () => Values
  });


  function IsBetween(value, min, max) {
    return value >= min && value <= max;
  }
  function IsZeroWidthJoiner(value) {
    return value === 8205;
  }
  function IsHighSurrogate(value) {
    return IsBetween(value, 55296, 56319);
  }
  function IsRegionalIndicator(value) {
    return IsBetween(value, 127462, 127487);
  }
  function IsVariationSelector(value) {
    return IsBetween(value, 65024, 65039);
  }
  function IsCombiningMark(value) {
    return IsBetween(value, 768, 879) || IsBetween(value, 6832, 6911) || IsBetween(value, 7616, 7679) || IsBetween(value, 65056, 65071);
  }
  function CodePointLength(value) {
    return value > 65535 ? 2 : 1;
  }
  function ConsumeModifiers(value, index3) {
    while (index3 < value.length) {
      const point = value.codePointAt(index3);
      if (IsCombiningMark(point) || IsVariationSelector(point)) {
        index3 += CodePointLength(point);
      } else {
        break;
      }
    }
    return index3;
  }
  function NextGraphemeClusterIndex(value, clusterStart) {
    const startCP = value.codePointAt(clusterStart);
    let clusterEnd = clusterStart + CodePointLength(startCP);
    clusterEnd = ConsumeModifiers(value, clusterEnd);
    while (clusterEnd < value.length - 1 && IsZeroWidthJoiner(value.codePointAt(clusterEnd))) {
      const nextCP = value.codePointAt(clusterEnd + 1);
      clusterEnd += 1 + CodePointLength(nextCP);
      clusterEnd = ConsumeModifiers(value, clusterEnd);
    }
    if (IsRegionalIndicator(startCP) && clusterEnd < value.length && IsRegionalIndicator(value.codePointAt(clusterEnd))) {
      clusterEnd += CodePointLength(value.codePointAt(clusterEnd));
    }
    return clusterEnd;
  }
  function IsGraphemeCodePoint(value) {
    return value >= 768 && // above special range
    (IsHighSurrogate(value) || IsCombiningMark(value) || IsVariationSelector(value) || IsZeroWidthJoiner(value));
  }
  function GraphemeCount(value) {
    let count = 0;
    let index3 = 0;
    while (index3 < value.length) {
      index3 = NextGraphemeClusterIndex(value, index3);
      count++;
    }
    return count;
  }
  function IsMinLengthSegmented(value, minLength) {
    let count = 0;
    let index3 = 0;
    while (index3 < value.length) {
      index3 = NextGraphemeClusterIndex(value, index3);
      if (++count >= minLength)
        return true;
    }
    return false;
  }
  function IsMaxLengthSegmented(value, maxLength) {
    let count = 0;
    let index3 = 0;
    while (index3 < value.length) {
      index3 = NextGraphemeClusterIndex(value, index3);
      if (++count > maxLength)
        return false;
    }
    return true;
  }
  function IsMinLength(value, minLength) {
    if (minLength === 0)
      return true;
    if (value.length < minLength)
      return false;
    let index3 = 0;
    while (true) {
      if (IsGraphemeCodePoint(value.charCodeAt(index3))) {
        return IsMinLengthSegmented(value, minLength);
      }
      if (++index3 >= minLength)
        return true;
    }
  }
  function IsMaxLength(value, maxLength) {
    if (value.length <= maxLength)
      return true;
    let index3 = 0;
    while (true) {
      if (IsGraphemeCodePoint(value.charCodeAt(index3))) {
        return IsMaxLengthSegmented(value, maxLength);
      }
      if (++index3 > maxLength)
        return false;
    }
  }


  function IsArray(value) {
    return Array.isArray(value);
  }
  function IsBigInt(value) {
    return IsEqual(typeof value, "bigint");
  }
  function IsBoolean(value) {
    return IsEqual(typeof value, "boolean");
  }
  function IsConstructor(value) {
    if (IsUndefined(value) || !IsFunction(value))
      return false;
    const result = Function.prototype.toString.call(value);
    if (/^class\s/.test(result))
      return true;
    if (/\[native code\]/.test(result))
      return true;
    return false;
  }
  function IsFunction(value) {
    return IsEqual(typeof value, "function");
  }
  function IsInteger(value) {
    return Number.isInteger(value);
  }
  function IsNull(value) {
    return IsEqual(value, null);
  }
  function IsNumber(value) {
    return Number.isFinite(value);
  }
  function IsObjectNotArray(value) {
    return IsObject(value) && !IsArray(value);
  }
  function IsObject(value) {
    return IsEqual(typeof value, "object") && !IsNull(value);
  }
  function IsString(value) {
    return IsEqual(typeof value, "string");
  }
  function IsSymbol(value) {
    return IsEqual(typeof value, "symbol");
  }
  function IsUndefined(value) {
    return IsEqual(value, void 0);
  }
  function IsEqual(left, right) {
    return left === right;
  }
  function IsGreaterThan(left, right) {
    return left > right;
  }
  function IsLessThan(left, right) {
    return left < right;
  }
  function IsLessEqualThan(left, right) {
    return left <= right;
  }
  function IsGreaterEqualThan(left, right) {
    return left >= right;
  }
  function IsMultipleOf(dividend, divisor) {
    if (IsBigInt(dividend) || IsBigInt(divisor)) {
      return BigInt(dividend) % BigInt(divisor) === 0n;
    }
    const tolerance = 1e-10;
    if (!IsNumber(dividend))
      return true;
    if (IsInteger(dividend) && 1 / divisor % 1 === 0)
      return true;
    const mod = dividend % divisor;
    return Math.min(Math.abs(mod), Math.abs(mod - divisor), Math.abs(mod + divisor)) < tolerance;
  }
  function IsClassInstance(value) {
    if (!IsObject(value))
      return false;
    const proto = globalThis.Object.getPrototypeOf(value);
    if (IsNull(proto))
      return false;
    return IsEqual(typeof proto.constructor, "function") && !(IsEqual(proto.constructor, globalThis.Object) || IsEqual(proto.constructor.name, "Object"));
  }
  function IsValueLike(value) {
    return IsBigInt(value) || IsBoolean(value) || IsNull(value) || IsNumber(value) || IsString(value) || IsUndefined(value);
  }
  function GraphemeCount2(value) {
    return GraphemeCount(value);
  }
  function IsMaxLength2(value, length) {
    return IsMaxLength(value, length);
  }
  function IsMinLength2(value, length) {
    return IsMinLength(value, length);
  }
  function Every(value, offset, callback) {
    return value.every((item, index3) => index3 < offset || callback(item, index3));
  }
  function EveryAll(value, offset, callback) {
    let result = true;
    value.forEach((item, index3) => {
      if (index3 >= offset && !callback(item, index3))
        result = false;
    });
    return result;
  }
  function Some(value, callback) {
    return value.some((value2, index3) => callback(value2, index3));
  }
  function SomeAll(value, callback) {
    let result = false;
    value.forEach((item, index3) => {
      if (callback(item, index3))
        result = true;
    });
    return result;
  }
  function Counted(value, callback) {
    return value.reduce((result, value2, index3) => callback(value2, index3) ? ++result : result, 0);
  }
  function ShiftLeft(array, true_, false_) {
    return IsEqual(array.length, 0) ? false_() : true_(array[0], array.slice(1));
  }
  function IsUnsafePropertyKey(key) {
    return IsEqual(key, "__proto__") || IsEqual(key, "constructor") || IsEqual(key, "prototype");
  }
  function HasPropertyKey(value, key) {
    return IsUnsafePropertyKey(key) ? Object.prototype.hasOwnProperty.call(value, key) : key in value;
  }
  function EntriesRegExp(value) {
    return Keys(value).map((key) => [new RegExp(`^${key}$`), value[key]]);
  }
  function Entries(value) {
    return Object.entries(value);
  }
  function Keys(value) {
    return Object.getOwnPropertyNames(value);
  }
  function Symbols(value) {
    return Object.getOwnPropertySymbols(value);
  }
  function Values(value) {
    return Object.values(value);
  }
  function DeepEqualObject(left, right) {
    if (!IsObject(right))
      return false;
    const keys = Keys(left);
    return IsEqual(keys.length, Keys(right).length) && keys.every((key) => IsDeepEqual(left[key], right[key]));
  }
  function DeepEqualArray(left, right) {
    return IsArray(right) && IsEqual(left.length, right.length) && left.every((_, index3) => IsDeepEqual(left[index3], right[index3]));
  }
  function IsDeepEqual(left, right) {
    return IsArray(left) ? DeepEqualArray(left, right) : IsObject(left) ? DeepEqualObject(left, right) : IsEqual(left, right);
  }


  var identifierRegExp = /^[\p{ID_Start}_$][\p{ID_Continue}_$\u200C\u200D]*$/u;
  function IsIdentifier(value) {
    return identifierRegExp.test(value);
  }
  function And(left, right) {
    return `(${left} && ${right})`;
  }
  function Or(left, right) {
    return `(${left} || ${right})`;
  }
  function Not(expr) {
    return `!(${expr})`;
  }
  function IsArray2(value) {
    return `Array.isArray(${value})`;
  }
  function IsBigInt2(value) {
    return `typeof ${value} === "bigint"`;
  }
  function IsBoolean2(value) {
    return `typeof ${value} === "boolean"`;
  }
  function IsInteger2(value) {
    return `Number.isInteger(${value})`;
  }
  function IsNull2(value) {
    return `${value} === null`;
  }
  function IsNumber2(value) {
    return `Number.isFinite(${value})`;
  }
  function IsObjectNotArray2(value) {
    return And(IsObject2(value), Not(IsArray2(value)));
  }
  function IsObject2(value) {
    return `typeof ${value} === "object" && ${value} !== null`;
  }
  function IsString2(value) {
    return `typeof ${value} === "string"`;
  }
  function IsSymbol2(value) {
    return `typeof ${value} === "symbol"`;
  }
  function IsUndefined2(value) {
    return `${value} === undefined`;
  }
  function IsFunction2(value) {
    return `typeof ${value} === "function"`;
  }
  function IsConstructor2(value) {
    return `Guard.IsConstructor(${value})`;
  }
  function IsEqual2(left, right) {
    return `${left} === ${right}`;
  }
  function IsGreaterThan2(left, right) {
    return `${left} > ${right}`;
  }
  function IsLessThan2(left, right) {
    return `${left} < ${right}`;
  }
  function IsLessEqualThan2(left, right) {
    return `${left} <= ${right}`;
  }
  function IsGreaterEqualThan2(left, right) {
    return `${left} >= ${right}`;
  }
  function IsMinLength3(value, length) {
    return `Guard.IsMinLength(${value}, ${length})`;
  }
  function IsMaxLength3(value, length) {
    return `Guard.IsMaxLength(${value}, ${length})`;
  }
  function Every2(value, offset, params, expression) {
    return IsEqual(offset, "0") ? `${value}.every((${params[0]}, ${params[1]}) => (${expression}))` : `${value}.every((${params[0]}, ${params[1]}) => (${params[1]} < ${offset}) || (${expression}))`;
  }
  function Some2(value, params, expression) {
    return `${value}.some((${params[0]}, ${params[1]}) => ${expression})`;
  }
  function SomeAll2(value, params, expression) {
    return `((value) => { let result = false; value.forEach((${params[0]}, ${params[1]}) => { if (${expression}) result = true }); return result })(${value})`;
  }
  function Counted2(value, params, expression) {
    return `${value}.reduce((result, ${params[0]}, ${params[1]}) => (${expression}) ? ++result : result, 0)`;
  }
  function Entries2(value) {
    return `Object.entries(${value})`;
  }
  function Keys2(value) {
    return `Object.getOwnPropertyNames(${value})`;
  }
  function HasPropertyKey2(value, key) {
    const isProtoField = IsEqual(key, '"__proto__"') || IsEqual(key, '"constructor"');
    return isProtoField ? `Object.prototype.hasOwnProperty.call(${value}, ${key})` : `${key} in ${value}`;
  }
  function IsDeepEqual2(left, right) {
    return `Guard.IsDeepEqual(${left}, ${right})`;
  }
  function ArrayLiteral(elements) {
    return `[${elements.join(", ")}]`;
  }
  function ArrowFunction(parameters, body) {
    return `((${parameters.join(", ")}) => ${body})`;
  }
  function Call(value, arguments_) {
    return `${value}(${arguments_.join(", ")})`;
  }
  function New(value, arguments_) {
    return `new ${value}(${arguments_.join(", ")})`;
  }
  function Member(left, right) {
    return `${left}${IsIdentifier(right) ? `.${right}` : `[${Constant(right)}]`}`;
  }
  function Constant(value) {
    if (!IsValueLike(value))
      throw Error("Unsupported Constant");
    return IsString(value) ? JSON.stringify(value) : `${value}`;
  }
  function Ternary(condition, true_, false_) {
    return `(${condition} ? ${true_} : ${false_})`;
  }
  function Statements(statements) {
    return `{ ${statements.join("; ")}; }`;
  }
  function ConstDeclaration(identifier, expression) {
    return `const ${identifier} = ${expression}`;
  }
  function If(condition, then) {
    return `if(${condition}) { ${then} }`;
  }
  function Return(expression) {
    return `return ${expression}`;
  }
  function ReduceAnd(operands) {
    return IsEqual(operands.length, 0) ? "true" : operands.reduce((left, right) => And(left, right));
  }
  function ReduceOr(operands) {
    return IsEqual(operands.length, 0) ? "false" : operands.reduce((left, right) => Or(left, right));
  }
  function MultipleOf(dividend, divisor) {
    return `Guard.IsMultipleOf(${dividend}, ${divisor})`;
  }


  var globals_exports = {};
  __export(globals_exports, {
    IsBigInt64Array: () => IsBigInt64Array,
    IsBigUint64Array: () => IsBigUint64Array,
    IsBoolean: () => IsBoolean3,
    IsDate: () => IsDate,
    IsFloat32Array: () => IsFloat32Array,
    IsFloat64Array: () => IsFloat64Array,
    IsInt16Array: () => IsInt16Array,
    IsInt32Array: () => IsInt32Array,
    IsInt8Array: () => IsInt8Array,
    IsMap: () => IsMap,
    IsNumber: () => IsNumber3,
    IsRegExp: () => IsRegExp,
    IsSet: () => IsSet,
    IsString: () => IsString3,
    IsTypeArray: () => IsTypeArray,
    IsUint16Array: () => IsUint16Array,
    IsUint32Array: () => IsUint32Array,
    IsUint8Array: () => IsUint8Array,
    IsUint8ClampedArray: () => IsUint8ClampedArray
  });
  function IsBoolean3(value) {
    return value instanceof Boolean;
  }
  function IsNumber3(value) {
    return value instanceof Number;
  }
  function IsString3(value) {
    return value instanceof String;
  }
  function IsTypeArray(value) {
    return globalThis.ArrayBuffer.isView(value);
  }
  function IsInt8Array(value) {
    return value instanceof globalThis.Int8Array;
  }
  function IsUint8Array(value) {
    return value instanceof globalThis.Uint8Array;
  }
  function IsUint8ClampedArray(value) {
    return value instanceof globalThis.Uint8ClampedArray;
  }
  function IsInt16Array(value) {
    return value instanceof globalThis.Int16Array;
  }
  function IsUint16Array(value) {
    return value instanceof globalThis.Uint16Array;
  }
  function IsInt32Array(value) {
    return value instanceof globalThis.Int32Array;
  }
  function IsUint32Array(value) {
    return value instanceof globalThis.Uint32Array;
  }
  function IsFloat32Array(value) {
    return value instanceof globalThis.Float32Array;
  }
  function IsFloat64Array(value) {
    return value instanceof globalThis.Float64Array;
  }
  function IsBigInt64Array(value) {
    return value instanceof globalThis.BigInt64Array;
  }
  function IsBigUint64Array(value) {
    return value instanceof globalThis.BigUint64Array;
  }
  function IsRegExp(value) {
    return value instanceof globalThis.RegExp;
  }
  function IsDate(value) {
    return value instanceof globalThis.Date;
  }
  function IsSet(value) {
    return value instanceof globalThis.Set;
  }
  function IsMap(value) {
    return value instanceof globalThis.Map;
  }


  var guard_default = guard_exports;


  var settings = {
    immutableTypes: false,
    maxErrors: 8,
    maxInstantiationCount: 128,
    useAcceleration: true,
    exactOptionalPropertyTypes: false,
    enumerableKind: false,
    correctiveParse: false,
    unionPrioritySort: true
  };
  function Reset() {
    settings.immutableTypes = false;
    settings.maxErrors = 8;
    settings.maxInstantiationCount = 128;
    settings.useAcceleration = true;
    settings.exactOptionalPropertyTypes = false;
    settings.enumerableKind = false;
    settings.correctiveParse = false;
    settings.unionPrioritySort = true;
  }
  function Set2(options) {
    for (const key of guard_exports.Keys(options)) {
      const value = options[key];
      if (value !== void 0) {
        Object.defineProperty(settings, key, { value });
      }
    }
  }
  function Get() {
    return settings;
  }


  function Freeze(value) {
    return settings_exports.Get().immutableTypes ? Object.freeze(value) : value;
  }


  function Assign(left, right) {
    Metrics.assign += 1;
    return Freeze({ ...left, ...right });
  }


  function FromClassInstance(value) {
    return value;
  }
  function IsSchemaObject(value) {
    return guard_exports.HasPropertyKey(value, "~kind") || guard_exports.HasPropertyKey(value, "~unsafe");
  }
  function FromSchemaObject(value) {
    const result = {};
    for (const key of guard_exports.Keys(value)) {
      if (guard_exports.IsUnsafePropertyKey(key))
        continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      descriptor.value = FromValue(descriptor.value);
      if (guard_exports.IsEqual(descriptor.enumerable, true)) {
        result[key] = descriptor.value;
      } else {
        Object.defineProperty(result, key, descriptor);
      }
    }
    return result;
  }
  function FromPlainObject(value) {
    const result = {};
    for (const key of guard_exports.Keys(value)) {
      if (guard_exports.IsUnsafePropertyKey(key))
        continue;
      result[key] = FromValue(value[key]);
    }
    for (const key of guard_exports.Symbols(value)) {
      result[key] = FromValue(value[key]);
    }
    return result;
  }
  function FromObject(value) {
    return guard_exports.IsClassInstance(value) ? FromClassInstance(value) : IsSchemaObject(value) ? FromSchemaObject(value) : FromPlainObject(value);
  }
  function FromArray(value) {
    return value.map((element) => FromValue(element));
  }
  function FromTypedArray(value) {
    return value.slice();
  }
  function FromRegExp(value) {
    return new RegExp(value.source, value.flags);
  }
  function FromMap(value) {
    return new Map(FromValue([...value.entries()]));
  }
  function FromSet(value) {
    return new Set(FromValue([...value.values()]));
  }
  function FromValue(value) {
    return globals_exports.IsTypeArray(value) ? FromTypedArray(value) : globals_exports.IsRegExp(value) ? FromRegExp(value) : globals_exports.IsMap(value) ? FromMap(value) : globals_exports.IsSet(value) ? FromSet(value) : guard_exports.IsArray(value) ? FromArray(value) : guard_exports.IsObject(value) ? FromObject(value) : value;
  }
  function Clone(value) {
    Metrics.clone += 1;
    return FromValue(value);
  }


  function MergeHidden(left, right) {
    for (const key of Object.keys(right)) {
      Object.defineProperty(left, key, {
        configurable: true,
        writable: true,
        enumerable: false,
        value: right[key]
      });
    }
    return left;
  }
  function Merge(left, right) {
    return { ...left, ...right };
  }
  function Create(hidden, enumerable, options = {}) {
    Metrics.create += 1;
    const withOptions = Merge(enumerable, options);
    const withHidden = settings_exports.Get().enumerableKind ? Merge(withOptions, hidden) : MergeHidden(withOptions, hidden);
    return Freeze(withHidden);
  }


  function Discard(value, propertyKeys) {
    Metrics.discard += 1;
    const result = {};
    for (const key of guard_exports.Keys(value)) {
      if (propertyKeys.includes(key))
        continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      descriptor.value = Clone(descriptor.value);
      Object.defineProperty(result, key, descriptor);
    }
    return Freeze(result);
  }


  function Update(current, hidden, enumerable) {
    Metrics.update += 1;
    const settings2 = settings_exports.Get();
    const result = Clone(current);
    for (const key of Object.keys(hidden)) {
      Object.defineProperty(result, key, {
        configurable: true,
        writable: true,
        enumerable: settings2.enumerableKind,
        value: hidden[key]
      });
    }
    for (const key of Object.keys(enumerable)) {
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: enumerable[key]
      });
    }
    return Freeze(result);
  }


  function IsKind(value, kind) {
    return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], kind);
  }
  function IsSchema(value) {
    return guard_exports.IsObject(value);
  }


  function Deferred(action, parameters, options) {
    return memory_exports.Create({ "~kind": "Deferred" }, { type: "deferred", action, parameters, options }, {});
  }
  function IsDeferred(value) {
    return IsKind(value, "Deferred");
  }


  function AddReadonlyOperation(type2) {
    return memory_exports.Update(type2, { "~readonly": true }, {});
  }
  function AddReadonlyAction(type2, options) {
    const result = memory_exports.Update(AddReadonlyOperation(type2), {}, options);
    return result;
  }
  function AddReadonlyInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return AddReadonlyAction(instantiatedType, options);
  }


  function AddOptionalOperation(type2) {
    return memory_exports.Update(type2, { "~optional": true }, {});
  }
  function AddOptionalAction(type2, options) {
    const result = memory_exports.Update(AddOptionalOperation(type2), {}, options);
    return result;
  }
  function AddOptionalInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return AddOptionalAction(instantiatedType, options);
  }


  function _Array_(items, options) {
    return memory_exports.Create({ "~kind": "Array" }, { type: "array", items }, options);
  }
  function IsArray3(value) {
    return IsKind(value, "Array");
  }
  function ArrayOptions(type2) {
    return memory_exports.Discard(type2, ["~kind", "type", "items"]);
  }


  function Constructor(parameters, instanceType, options = {}) {
    return memory_exports.Create({ "~kind": "Constructor" }, { type: "constructor", parameters, instanceType }, options);
  }
  function IsConstructor3(value) {
    return IsKind(value, "Constructor");
  }
  function ConstructorOptions(type2) {
    return memory_exports.Discard(type2, ["~kind", "type", "parameters", "instanceType"]);
  }


  function _Function_(parameters, returnType, options = {}) {
    return memory_exports.Create({ ["~kind"]: "Function" }, { type: "function", parameters, returnType }, options);
  }
  function IsFunction3(value) {
    return IsKind(value, "Function");
  }
  function FunctionOptions(type2) {
    return memory_exports.Discard(type2, ["~kind", "type", "parameters", "returnType"]);
  }


  function Ref(ref, options) {
    return memory_exports.Create({ ["~kind"]: "Ref" }, { $ref: ref }, options);
  }
  function IsRef(value) {
    return IsKind(value, "Ref");
  }


  function Generic(parameters, expression) {
    return memory_exports.Create({ "~kind": "Generic" }, { type: "generic", parameters, expression });
  }
  function IsGeneric(value) {
    return IsKind(value, "Generic");
  }


  function Any(options) {
    return memory_exports.Create({ ["~kind"]: "Any" }, {}, options);
  }
  function IsAny(value) {
    return IsKind(value, "Any");
  }


  var NeverPattern = "(?!)";
  function Never(options) {
    return memory_exports.Create({ "~kind": "Never" }, { not: {} }, options);
  }
  function IsNever(value) {
    return IsKind(value, "Never");
  }


  function AddOptionalDeferred(type2, options = {}) {
    return Deferred("AddOptional", [type2], options);
  }
  function AddOptional(type2, options = {}) {
    return AddOptionalAction(type2, options);
  }


  function Optional(type2) {
    return AddOptional(type2);
  }
  function IsOptional(value) {
    return IsSchema(value) && guard_exports.HasPropertyKey(value, "~optional");
  }


  function RequiredArray(properties) {
    return guard_exports.Keys(properties).filter((key) => !IsOptional(properties[key]));
  }
  function PropertyKeys(properties) {
    return guard_exports.Keys(properties);
  }
  function PropertyValues(properties) {
    return guard_exports.Values(properties);
  }


  function _Object_(properties, options = {}) {
    const requiredKeys = RequiredArray(properties);
    const required = requiredKeys.length > 0 ? { required: requiredKeys } : {};
    return memory_exports.Create({ "~kind": "Object" }, { type: "object", ...required, properties }, options);
  }
  function IsObject3(value) {
    return IsKind(value, "Object");
  }
  function ObjectOptions(type2) {
    return memory_exports.Discard(type2, ["~kind", "type", "properties", "required"]);
  }


  function Unknown(options) {
    return memory_exports.Create({ ["~kind"]: "Unknown" }, {}, options);
  }
  function IsUnknown(value) {
    return IsKind(value, "Unknown");
  }


  function Cyclic($defs, $ref, options) {
    const defs = guard_exports.Keys($defs).reduce((result, key) => {
      return { ...result, [key]: memory_exports.Update($defs[key], {}, { $id: key }) };
    }, {});
    return memory_exports.Create({ ["~kind"]: "Cyclic" }, { $defs: defs, $ref }, options);
  }
  function IsCyclic(value) {
    return IsKind(value, "Cyclic");
  }
  function CyclicOptions(type2) {
    return memory_exports.Discard(type2, ["~kind", "$defs", "$ref"]);
  }


  function Unsafe(schema) {
    return memory_exports.Update(schema, { ["~unsafe"]: null }, {});
  }
  function IsUnsafe(value) {
    return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "~unsafe") && guard_exports.IsNull(value["~unsafe"]);
  }


  var arguments_exports = {};
  __export(arguments_exports, {
    Match: () => Match
  });
  function Match(args, match2) {
    return match2[args.length]?.(...args) ?? (() => {
      throw Error("Invalid Arguments");
    })();
  }


  function Infer(...args) {
    const [name, extends_] = arguments_exports.Match(args, {
      2: (name2, extends_2) => [name2, extends_2, extends_2],
      1: (name2) => [name2, Unknown(), Unknown()]
    });
    return memory_exports.Create({ ["~kind"]: "Infer" }, { type: "infer", name, extends: extends_ }, {});
  }
  function IsInfer(value) {
    return IsKind(value, "Infer");
  }


  function Dependent(if_, then_, else_, options = {}) {
    return memory_exports.Create({ "~kind": "Dependent" }, { if: if_, then: then_, else: else_ }, options);
  }
  function IsDependent(value) {
    return IsKind(value, "Dependent");
  }
  function DependentOptions(type2) {
    return memory_exports.Discard(type2, ["~kind", "if", "then", "else"]);
  }


  function IsTypeScriptEnumLike(value) {
    return guard_exports.IsObjectNotArray(value);
  }
  function TypeScriptEnumToEnumValues(type2) {
    const keys = guard_exports.Keys(type2).filter((key) => isNaN(key));
    return keys.reduce((result, key) => [...result, type2[key]], []);
  }


  function IsEnumValue(value) {
    return guard_exports.IsString(value) || guard_exports.IsNumber(value);
  }
  function Enum(value, options) {
    const values = IsTypeScriptEnumLike(value) ? TypeScriptEnumToEnumValues(value) : value;
    return memory_exports.Create({ "~kind": "Enum" }, { enum: values }, options);
  }
  function IsEnum(value) {
    return IsKind(value, "Enum");
  }


  function Intersect(types2, options = {}) {
    return memory_exports.Create({ "~kind": "Intersect" }, { allOf: types2 }, options);
  }
  function IsIntersect(value) {
    return IsKind(value, "Intersect");
  }
  function IntersectOptions(type2) {
    return memory_exports.Discard(type2, ["~kind", "allOf"]);
  }


  var environment_exports = {};
  __export(environment_exports, {
    CanEvaluate: () => CanEvaluate,
    Evaluate: () => Evaluate
  });


  var supported = void 0;
  function TryEvaluate() {
    try {
      Evaluate("null")();
      return true;
    } catch {
      return false;
    }
  }
  function CanEvaluate() {
    if (guard_exports.IsUndefined(supported))
      supported = TryEvaluate();
    return supported && settings_exports.Get().useAcceleration;
  }
  function Evaluate(...args) {
    return new globalThis.Function(...args);
  }


  var hash_exports = {};
  __export(hash_exports, {
    Hash: () => Hash,
    HashCode: () => HashCode
  });


  function Unreachable() {
    throw new Error("Unreachable");
  }


  function InstanceKeys(value) {
    const propertyKeys = /* @__PURE__ */ new Set();
    let current = value;
    while (current && current !== Object.prototype) {
      for (const key of Reflect.ownKeys(current)) {
        if (key !== "constructor" && typeof key !== "symbol")
          propertyKeys.add(key);
      }
      current = Object.getPrototypeOf(current);
    }
    return [...propertyKeys];
  }
  function IsIEEE754(value) {
    return typeof value === "number";
  }
  var ByteMarker;
  (function(ByteMarker2) {
    ByteMarker2[ByteMarker2["Array"] = 0] = "Array";
    ByteMarker2[ByteMarker2["BigInt"] = 1] = "BigInt";
    ByteMarker2[ByteMarker2["Boolean"] = 2] = "Boolean";
    ByteMarker2[ByteMarker2["Date"] = 3] = "Date";
    ByteMarker2[ByteMarker2["Constructor"] = 4] = "Constructor";
    ByteMarker2[ByteMarker2["Function"] = 5] = "Function";
    ByteMarker2[ByteMarker2["Null"] = 6] = "Null";
    ByteMarker2[ByteMarker2["Number"] = 7] = "Number";
    ByteMarker2[ByteMarker2["Object"] = 8] = "Object";
    ByteMarker2[ByteMarker2["RegExp"] = 9] = "RegExp";
    ByteMarker2[ByteMarker2["String"] = 10] = "String";
    ByteMarker2[ByteMarker2["Symbol"] = 11] = "Symbol";
    ByteMarker2[ByteMarker2["TypeArray"] = 12] = "TypeArray";
    ByteMarker2[ByteMarker2["Undefined"] = 13] = "Undefined";
  })(ByteMarker || (ByteMarker = {}));
  var Accumulator = BigInt("14695981039346656037");
  var [Prime, Size] = [BigInt("1099511628211"), BigInt(
    "18446744073709551616"
    /* 2 ^ 64 */
  )];
  var Bytes = Array.from({ length: 256 }).map((_, i) => BigInt(i));
  var F64 = new Float64Array(1);
  var F64In = new DataView(F64.buffer);
  var F64Out = new Uint8Array(F64.buffer);
  function FNV1A64_OP(byte) {
    Accumulator = Accumulator ^ Bytes[byte];
    Accumulator = Accumulator * Prime % Size;
  }
  function FromArray2(value) {
    FNV1A64_OP(ByteMarker.Array);
    for (const item of value) {
      FromValue2(item);
    }
  }
  function FromBigInt(value) {
    FNV1A64_OP(ByteMarker.BigInt);
    F64In.setBigInt64(0, value);
    for (const byte of F64Out) {
      FNV1A64_OP(byte);
    }
  }
  function FromBoolean(value) {
    FNV1A64_OP(ByteMarker.Boolean);
    FNV1A64_OP(value ? 1 : 0);
  }
  function FromConstructor(value) {
    FNV1A64_OP(ByteMarker.Constructor);
    FromValue2(value.toString());
  }
  function FromDate(value) {
    FNV1A64_OP(ByteMarker.Date);
    FromValue2(value.getTime());
  }
  function FromFunction(value) {
    FNV1A64_OP(ByteMarker.Function);
    FromValue2(value.toString());
  }
  function FromNull(_value) {
    FNV1A64_OP(ByteMarker.Null);
  }
  function FromNumber(value) {
    FNV1A64_OP(ByteMarker.Number);
    F64In.setFloat64(
      0,
      value,
      true
      /* little-endian */
    );
    for (const byte of F64Out) {
      FNV1A64_OP(byte);
    }
  }
  function FromObject2(value) {
    FNV1A64_OP(ByteMarker.Object);
    for (const key of InstanceKeys(value).sort()) {
      FromValue2(key);
      FromValue2(value[key]);
    }
  }
  function FromRegExp2(value) {
    FNV1A64_OP(ByteMarker.RegExp);
    FromString(value.toString());
  }
  var encoder = new TextEncoder();
  function FromString(value) {
    FNV1A64_OP(ByteMarker.String);
    for (const byte of encoder.encode(value)) {
      FNV1A64_OP(byte);
    }
  }
  function FromSymbol(value) {
    FNV1A64_OP(ByteMarker.Symbol);
    FromValue2(value.toString());
  }
  function FromTypeArray(value) {
    FNV1A64_OP(ByteMarker.TypeArray);
    const buffer = new Uint8Array(value.buffer);
    for (let i = 0; i < buffer.length; i++) {
      FNV1A64_OP(buffer[i]);
    }
  }
  function FromUndefined(_value) {
    return FNV1A64_OP(ByteMarker.Undefined);
  }
  function FromValue2(value) {
    return globals_exports.IsTypeArray(value) ? FromTypeArray(value) : globals_exports.IsDate(value) ? FromDate(value) : globals_exports.IsRegExp(value) ? FromRegExp2(value) : globals_exports.IsBoolean(value) ? FromBoolean(value.valueOf()) : globals_exports.IsString(value) ? FromString(value.valueOf()) : globals_exports.IsNumber(value) ? FromNumber(value.valueOf()) : IsIEEE754(value) ? FromNumber(value) : guard_exports.IsArray(value) ? FromArray2(value) : guard_exports.IsBoolean(value) ? FromBoolean(value) : guard_exports.IsBigInt(value) ? FromBigInt(value) : guard_exports.IsConstructor(value) ? FromConstructor(value) : guard_exports.IsNull(value) ? FromNull(value) : guard_exports.IsObject(value) ? FromObject2(value) : guard_exports.IsString(value) ? FromString(value) : guard_exports.IsSymbol(value) ? FromSymbol(value) : guard_exports.IsUndefined(value) ? FromUndefined(value) : guard_exports.IsFunction(value) ? FromFunction(value) : Unreachable();
  }
  function HashCode(value) {
    Accumulator = BigInt("14695981039346656037");
    FromValue2(value);
    return Accumulator;
  }
  function Hash(value) {
    return HashCode(value).toString(16).padStart(16, "0");
  }


  function en_US(error2) {
    switch (error2.keyword) {
      case "additionalProperties":
        return "must not have additional properties";
      case "anyOf":
        return "must match a schema in anyOf";
      case "boolean":
        return "schema is false";
      case "const":
        return "must be equal to constant";
      case "contains":
        return "must contain at least 1 valid item";
      case "dependencies":
        return `must have properties ${error2.params.dependencies.join(", ")} when property ${error2.params.property} is present`;
      case "dependentRequired":
        return `must have properties ${error2.params.dependencies.join(", ")} when property ${error2.params.property} is present`;
      case "enum":
        return "must be equal to one of the allowed values";
      case "exclusiveMaximum":
        return `must be ${error2.params.comparison} ${error2.params.limit}`;
      case "exclusiveMinimum":
        return `must be ${error2.params.comparison} ${error2.params.limit}`;
      case "format":
        return `must match format "${error2.params.format}"`;
      case "if":
        return `must match "${error2.params.failingKeyword}" schema`;
      case "maxItems":
        return `must not have more than ${error2.params.limit} items`;
      case "maxLength":
        return `must not have more than ${error2.params.limit} characters`;
      case "maxProperties":
        return `must not have more than ${error2.params.limit} properties`;
      case "maximum":
        return `must be ${error2.params.comparison} ${error2.params.limit}`;
      case "minItems":
        return `must not have fewer than ${error2.params.limit} items`;
      case "minLength":
        return `must not have fewer than ${error2.params.limit} characters`;
      case "minProperties":
        return `must not have fewer than ${error2.params.limit} properties`;
      case "minimum":
        return `must be ${error2.params.comparison} ${error2.params.limit}`;
      case "multipleOf":
        return `must be multiple of ${error2.params.multipleOf}`;
      case "not":
        return "must not be valid";
      case "oneOf":
        return "must match exactly one schema in oneOf";
      case "pattern":
        return `must match pattern "${error2.params.pattern}"`;
      case "propertyNames":
        return `property names ${error2.params.propertyNames.join(", ")} are invalid`;
      case "required":
        return `must have required properties ${error2.params.requiredProperties.join(", ")}`;
      case "type":
        return typeof error2.params.type === "string" ? `must be ${error2.params.type}` : `must be either ${error2.params.type.join(" or ")}`;
      case "unevaluatedItems":
        return "must not have unevaluated items";
      case "unevaluatedProperties":
        return "must not have unevaluated properties";
      case "uniqueItems":
        return `must not have duplicate items`;
      case "~refine":
        return error2.params.message;
      // deno-coverage-ignore - unreachable
      default:
        return "an unknown validation error occurred";
    }
  }


  var locale = en_US;
  function Get2() {
    return locale;
  }


  var EncodeBuilder = class {
    constructor(type2, decode) {
      this.type = type2;
      this.decode = decode;
    }
    Encode(callback) {
      const type2 = this.type;
      const decode = IsCodec(type2) ? (value) => this.decode(type2["~codec"].decode(value)) : this.decode;
      const encode = IsCodec(type2) ? (value) => type2["~codec"].encode(callback(value)) : callback;
      const codec = { decode, encode };
      return memory_exports.Update(this.type, { "~codec": codec }, {});
    }
  };
  var DecodeBuilder = class {
    constructor(type2) {
      this.type = type2;
    }
    Decode(callback) {
      return new EncodeBuilder(this.type, callback);
    }
  };
  function Codec(type2) {
    return new DecodeBuilder(type2);
  }
  function Decode(type2, callback) {
    return Codec(type2).Decode(callback).Encode(() => {
      throw Error("Encode not implemented");
    });
  }
  function Encode(type2, callback) {
    return Codec(type2).Decode(() => {
      throw Error("Decode not implemented");
    }).Encode(callback);
  }
  function IsCodec(value) {
    return IsSchema(value) && guard_exports.HasPropertyKey(value, "~codec") && guard_exports.IsObject(value["~codec"]) && guard_exports.HasPropertyKey(value["~codec"], "encode") && guard_exports.HasPropertyKey(value["~codec"], "decode");
  }


  function Immutable(type2) {
    return AddImmutable(type2);
  }
  function IsImmutable(value) {
    return IsSchema(value) && guard_exports.HasPropertyKey(value, "~immutable");
  }


  function AddReadonlyDeferred(type2, options = {}) {
    return Deferred("AddReadonly", [type2], options);
  }
  function AddReadonly(type2, options = {}) {
    return AddReadonlyAction(type2, options);
  }


  function Readonly(type2) {
    return AddReadonly(type2);
  }
  function IsReadonly(value) {
    return IsSchema(value) && guard_exports.HasPropertyKey(value, "~readonly");
  }


  function RefineAdd(type2, refinement) {
    const refinements = IsRefine(type2) ? [...type2["~refine"], refinement] : [refinement];
    return memory_exports.Update(type2, { "~refine": refinements }, {});
  }
  function Refine(...args) {
    const [type2, check, error2] = arguments_exports.Match(args, {
      3: (type3, check2, error3) => [type3, check2, error3],
      2: (type3, check2) => [type3, check2, () => "Refine Error"]
    });
    return RefineAdd(type2, { check, error: error2 });
  }
  function IsRefinement(value) {
    return guard_exports.IsObjectNotArray(value) && guard_exports.HasPropertyKey(value, "check") && guard_exports.HasPropertyKey(value, "error") && guard_exports.IsFunction(value.check) && guard_exports.IsFunction(value.error);
  }
  function IsRefine(value) {
    return IsSchema(value) && guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => IsRefinement(value2));
  }


  var BigIntPattern = "-?(?:0|[1-9][0-9]*)n";
  function BigInt2(options) {
    return memory_exports.Create({ "~kind": "BigInt" }, { type: "bigint" }, options);
  }
  function IsBigInt3(value) {
    return IsKind(value, "BigInt");
  }


  function Boolean2(options) {
    return memory_exports.Create({ "~kind": "Boolean" }, { type: "boolean" }, options);
  }
  function IsBoolean4(value) {
    return IsKind(value, "Boolean");
  }


  function Identifier(name) {
    return memory_exports.Create({ "~kind": "Identifier" }, { name });
  }
  function IsIdentifier2(value) {
    return IsKind(value, "Identifier");
  }


  var IntegerPattern = "-?(?:0|[1-9][0-9]*)";
  function Integer(options) {
    return memory_exports.Create({ "~kind": "Integer" }, { type: "integer" }, options);
  }
  function IsInteger3(value) {
    return IsKind(value, "Integer");
  }


  var InvalidLiteralValue = class extends Error {
    constructor(value) {
      super(`Invalid Literal value`);
      Object.defineProperty(this, "cause", {
        value: { value },
        writable: false,
        configurable: false,
        enumerable: false
      });
    }
  };
  function LiteralTypeName(value) {
    return guard_exports.IsBigInt(value) ? "bigint" : guard_exports.IsBoolean(value) ? "boolean" : guard_exports.IsNumber(value) ? "number" : guard_exports.IsString(value) ? "string" : (() => {
      throw new InvalidLiteralValue(value);
    })();
  }
  function Literal(value, options) {
    return memory_exports.Create({ "~kind": "Literal" }, { type: LiteralTypeName(value), const: value }, options);
  }
  function IsLiteralValue(value) {
    return guard_exports.IsBigInt(value) || guard_exports.IsBoolean(value) || guard_exports.IsNumber(value) || guard_exports.IsString(value);
  }
  function IsLiteralBigInt(value) {
    return IsLiteral(value) && guard_exports.IsBigInt(value.const);
  }
  function IsLiteralBoolean(value) {
    return IsLiteral(value) && guard_exports.IsBoolean(value.const);
  }
  function IsLiteralNumber(value) {
    return IsLiteral(value) && guard_exports.IsNumber(value.const);
  }
  function IsLiteralString(value) {
    return IsLiteral(value) && guard_exports.IsString(value.const);
  }
  function IsLiteral(value) {
    return IsKind(value, "Literal");
  }


  function Null(options) {
    return memory_exports.Create({ "~kind": "Null" }, { type: "null" }, options);
  }
  function IsNull3(value) {
    return IsKind(value, "Null");
  }


  var NumberPattern = "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?";
  function Number2(options) {
    return memory_exports.Create({ "~kind": "Number" }, { type: "number" }, options);
  }
  function IsNumber4(value) {
    return IsKind(value, "Number");
  }


  function Symbol2(options) {
    return memory_exports.Create({ "~kind": "Symbol" }, { type: "symbol" }, options);
  }
  function IsSymbol3(value) {
    return IsKind(value, "Symbol");
  }


  function Parameter(...args) {
    const [name, extends_, equals] = arguments_exports.Match(args, {
      3: (name2, extends_2, equals2) => [name2, extends_2, equals2],
      2: (name2, extends_2) => [name2, extends_2, extends_2],
      1: (name2) => [name2, Unknown(), Unknown()]
    });
    return memory_exports.Create({ "~kind": "Parameter" }, { name, extends: extends_, equals }, {});
  }
  function IsParameter(value) {
    return IsKind(value, "Parameter");
  }


  var StringPattern = ".*";
  function String2(options) {
    return memory_exports.Create({ "~kind": "String" }, { type: "string" }, options);
  }
  function IsString4(value) {
    return IsKind(value, "String");
  }


  function Union(anyOf, options = {}) {
    return memory_exports.Create({ "~kind": "Union" }, { anyOf }, options);
  }
  function IsUnion(value) {
    return IsKind(value, "Union");
  }
  function UnionOptions(type2) {
    return memory_exports.Discard(type2, ["~kind", "anyOf"]);
  }


  function ParsePatternIntoTypes(pattern) {
    const parsed = Pattern(pattern);
    const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : [];
    return result;
  }


  function FromLiteral(_value) {
    return true;
  }
  function FromTypesReduce(types2) {
    return guard_exports.ShiftLeft(types2, (left, right) => FromType(left) ? FromTypesReduce(right) : false, () => true);
  }
  function FromTypes(types2) {
    const result = guard_exports.IsEqual(types2.length, 0) ? false : FromTypesReduce(types2);
    return result;
  }
  function FromType(type2) {
    return IsUnion(type2) ? FromTypes(type2.anyOf) : IsLiteral(type2) ? FromLiteral(type2.const) : false;
  }
  function IsTemplateLiteralFinite(types2) {
    const result = FromTypes(types2);
    return result;
  }


  function TemplateLiteralCreate(pattern) {
    return memory_exports.Create({ ["~kind"]: "TemplateLiteral" }, { type: "string", pattern }, {});
  }


  function FromLiteralPush(variants, value, result = []) {
    return guard_exports.ShiftLeft(variants, (left, right) => FromLiteralPush(right, value, [...result, `${left}${value}`]), () => result);
  }
  function FromLiteral2(variants, value) {
    return guard_exports.IsEqual(variants.length, 0) ? [`${value}`] : FromLiteralPush(variants, value);
  }
  function FromUnion(variants, types2, result = []) {
    return guard_exports.ShiftLeft(types2, (left, right) => FromUnion(variants, right, [...result, ...FromType2(variants, left)]), () => result);
  }
  function FromType2(variants, type2) {
    const result = IsUnion(type2) ? FromUnion(variants, type2.anyOf) : IsLiteral(type2) ? FromLiteral2(variants, type2.const) : Unreachable();
    return result;
  }
  function DecodeFromSpan(variants, types2) {
    return guard_exports.ShiftLeft(types2, (left, right) => DecodeFromSpan(FromType2(variants, left), right), () => variants);
  }
  function VariantsToLiterals(variants) {
    return variants.map((variant2) => Literal(variant2));
  }
  function DecodeTypesAsUnion(types2) {
    const variants = DecodeFromSpan([], types2);
    const literals = VariantsToLiterals(variants);
    const result = Union(literals);
    return result;
  }
  function DecodeTypes(types2) {
    return guard_exports.IsEqual(types2.length, 0) ? Unreachable() : (
      // Literal('') :
      guard_exports.IsEqual(types2.length, 1) && IsLiteral(types2[0]) ? types2[0] : DecodeTypesAsUnion(types2)
    );
  }
  function TemplateLiteralDecodeUnsafe(pattern) {
    const types2 = ParsePatternIntoTypes(pattern);
    const result = guard_exports.IsEqual(types2.length, 0) ? String2() : IsTemplateLiteralFinite(types2) ? DecodeTypes(types2) : TemplateLiteralCreate(pattern);
    return result;
  }
  function TemplateLiteralDecode(pattern) {
    const decoded = TemplateLiteralDecodeUnsafe(pattern);
    const result = IsTemplateLiteral(decoded) ? String2() : decoded;
    return result;
  }


  function CreateRecord(key, value) {
    const type2 = "object";
    const patternProperties = { [key]: value };
    return memory_exports.Create({ ["~kind"]: "Record" }, { type: type2, patternProperties });
  }


  function FromAnyKey(value) {
    return CreateRecord(StringKey, value);
  }


  function FromBooleanKey(value) {
    return _Object_({ true: value, false: value });
  }


  function Tuple(types2, options = {}) {
    const [items, minItems, additionalItems] = [types2, types2.length, false];
    return memory_exports.Create({ ["~kind"]: "Tuple" }, { type: "array", additionalItems, items, minItems }, options);
  }
  function IsTuple(value) {
    return IsKind(value, "Tuple");
  }
  function TupleOptions(type2) {
    return memory_exports.Discard(type2, ["~kind", "type", "items", "minItems", "additionalItems"]);
  }


  function RemoveReadonlyOperation(type2) {
    return memory_exports.Discard(type2, ["~readonly"]);
  }
  function RemoveReadonlyAction(type2, options) {
    const result = memory_exports.Update(RemoveReadonlyOperation(type2), {}, options);
    return result;
  }
  function RemoveReadonlyInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return RemoveReadonlyAction(instantiatedType, options);
  }


  function RemoveReadonlyDeferred(type2, options = {}) {
    return Deferred("RemoveReadonly", [type2], options);
  }
  function RemoveReadonly(type2, options = {}) {
    return RemoveReadonlyAction(type2, options);
  }


  function RemoveOptionalOperation(type2) {
    return memory_exports.Discard(type2, ["~optional"]);
  }
  function RemoveOptionalAction(type2, options) {
    const result = memory_exports.Update(RemoveOptionalOperation(type2), {}, options);
    return result;
  }
  function RemoveOptionalInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return RemoveOptionalAction(instantiatedType, options);
  }


  function RemoveOptionalDeferred(type2, options = {}) {
    return Deferred("RemoveOptional", [type2], options);
  }
  function RemoveOptional(type2, options = {}) {
    return RemoveOptionalAction(type2, options);
  }


  function TupleElementsToProperties(types2) {
    const result = types2.reduceRight((result2, right, index3) => {
      return { [index3]: right, ...result2 };
    }, {});
    return result;
  }
  function TupleToObject(type2) {
    const properties = TupleElementsToProperties(type2.items);
    const result = _Object_(properties);
    return result;
  }


  function CanComposite(type2) {
    return IsObject3(type2) || IsTuple(type2);
  }
  function IsReadonlyProperty(left, right) {
    return IsReadonly(left) ? IsReadonly(right) ? true : false : false;
  }
  function IsOptionalProperty(left, right) {
    return IsOptional(left) ? IsOptional(right) ? true : false : false;
  }
  function CompositeProperty(left, right) {
    const isReadonly = IsReadonlyProperty(left, right);
    const isOptional = IsOptionalProperty(left, right);
    const evaluated = EvaluateIntersect([left, right]);
    const property = RemoveReadonly(RemoveOptional(evaluated));
    return isReadonly && isOptional ? AddReadonly(AddOptional(property)) : isReadonly && !isOptional ? AddReadonly(property) : !isReadonly && isOptional ? AddOptional(property) : property;
  }
  function CompositePropertyKey(left, right, key) {
    return key in left ? key in right ? CompositeProperty(left[key], right[key]) : left[key] : key in right ? right[key] : Never();
  }
  function CompositeProperties(left, right) {
    const keys = /* @__PURE__ */ new Set([...guard_exports.Keys(left), ...guard_exports.Keys(right)]);
    const result = [...keys].reduce((result2, key) => {
      return { ...result2, [key]: CompositePropertyKey(left, right, key) };
    }, {});
    return result;
  }
  function GetProperties(type2) {
    const result = IsObject3(type2) ? type2.properties : IsTuple(type2) ? TupleElementsToProperties(type2.items) : {};
    return result;
  }
  function Composite(left, right) {
    const leftProperties = GetProperties(left);
    const rightProperties = GetProperties(right);
    const properties = CompositeProperties(leftProperties, rightProperties);
    const result = _Object_(properties);
    return result;
  }


  function NarrowCompareRule(left, right) {
    const result = Compare(left, right);
    return guard_exports.IsEqual(result, CompareResultLeftInside) ? left : guard_exports.IsEqual(result, CompareResultRightInside) ? right : guard_exports.IsEqual(result, CompareResultEqual) ? right : Never();
  }
  function NarrowCompositeRule(left, right) {
    const canCompositeLeft = CanComposite(left);
    const canCompositeRight = CanComposite(right);
    return canCompositeLeft && canCompositeRight ? Composite(left, right) : canCompositeLeft && !canCompositeRight ? left : !canCompositeLeft && canCompositeRight ? right : NarrowCompareRule(left, right);
  }
  function Narrow(left, right) {
    return IsNever(left) ? left : IsAny(left) ? left : IsUnknown(left) ? right : IsNever(right) ? right : IsAny(right) ? right : IsUnknown(right) ? left : NarrowCompositeRule(left, right);
  }


  function ShouldEvaluate(left, right) {
    const result = IsUnion(left) || IsUnion(right);
    return result;
  }
  function DistributeOperation(left, right) {
    const evaluatedLeft = EvaluateType(left);
    const evaluatedRight = EvaluateType(right);
    const shouldEvaluate = ShouldEvaluate(evaluatedLeft, evaluatedRight);
    const result = shouldEvaluate ? EvaluateIntersect([evaluatedLeft, evaluatedRight]) : Narrow(evaluatedLeft, evaluatedRight);
    return result;
  }
  function DistributeType(type2, types2, result = []) {
    return guard_exports.ShiftLeft(types2, (left, right) => DistributeType(type2, right, [...result, DistributeOperation(left, type2)]), () => guard_exports.IsEqual(result.length, 0) ? [type2] : result);
  }
  function DistributeUnion(types2, distribution, result = []) {
    return guard_exports.ShiftLeft(types2, (left, right) => DistributeUnion(right, distribution, [...result, ...Distribute([left], distribution)]), () => result);
  }
  function Distribute(types2, result = []) {
    return guard_exports.ShiftLeft(types2, (left, right) => IsUnion(left) ? Distribute(right, DistributeUnion(left.anyOf, result)) : Distribute(right, DistributeType(left, result)), () => result);
  }


  function ExcludeType(left, right) {
    const check = Extends({}, left, right);
    const result = result_exports.IsExtendsTrueLike(check) ? [] : [left];
    return result;
  }
  function ExcludeUnion(left, right, result = []) {
    return guard_exports.ShiftLeft(left, (head, tail) => ExcludeUnion(tail, right, [...result, ...ExcludeType(head, right)]), () => result);
  }
  function ExcludeOperation(left, right) {
    const evaluated = EvaluateType(left);
    const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
    const remaining = ExcludeUnion(canonical, right);
    const result = EvaluateUnion(remaining);
    return result;
  }


  function EvaluateDependent(if_, then_, else_) {
    const intersected = EvaluateIntersect([if_, then_]);
    const excluded = ExcludeOperation(else_, if_);
    const result = EvaluateUnion([intersected, excluded]);
    return result;
  }
  function EvaluateEnum(values, result = []) {
    return guard_exports.ShiftLeft(values, (left, right) => EvaluateEnum(right, [...result, Literal(left)]), () => EvaluateUnion(result));
  }
  function EvaluateIntersect(types2) {
    const distribution = Distribute(types2);
    const broadend = Broaden(distribution);
    const result = EvaluateUnion(broadend);
    return result;
  }
  function EvaluateTemplateLiteral(pattern) {
    const evaluated = TemplateLiteralDecode(pattern);
    const result = EvaluateType(evaluated);
    return result;
  }
  function EvaluateUnion(types2) {
    const broadend = Broaden(types2);
    const result = EvaluateUnionFast(broadend);
    return result;
  }
  function EvaluateType(type2) {
    const result = IsDependent(type2) ? EvaluateDependent(type2.if, type2.then, type2.else) : IsEnum(type2) ? EvaluateEnum(type2.enum) : IsIntersect(type2) ? EvaluateIntersect(type2.allOf) : IsTemplateLiteral(type2) ? EvaluateTemplateLiteral(type2.pattern) : IsUnion(type2) ? EvaluateUnion(type2.anyOf) : type2;
    return result;
  }
  function EvaluateUnionFast(types2) {
    const result = guard_exports.IsEqual(types2.length, 1) ? types2[0] : guard_exports.IsEqual(types2.length, 0) ? Never() : Union(types2);
    return result;
  }


  function FromEnumKey(values, value) {
    const unionKey = EvaluateEnum(values);
    const result = FromKey(unionKey, value);
    return result;
  }


  function FromIntegerKey(_key, value) {
    const result = CreateRecord(IntegerKey, value);
    return result;
  }


  function FromIntersectKey(types2, value) {
    const evaluatedKey = EvaluateIntersect(types2);
    const result = FromKey(evaluatedKey, value);
    return result;
  }


  function FromLiteralKey(key, value) {
    return guard_exports.IsString(key) || guard_exports.IsNumber(key) ? _Object_({ [key]: value }) : guard_exports.IsEqual(key, false) ? _Object_({ false: value }) : guard_exports.IsEqual(key, true) ? _Object_({ true: value }) : _Object_({});
  }


  function FromNumberKey(_key, value) {
    const result = CreateRecord(NumberKey, value);
    return result;
  }


  function FromStringKey(key, value) {
    return guard_exports.HasPropertyKey(key, "pattern") && (guard_exports.IsString(key.pattern) || key.pattern instanceof RegExp) ? CreateRecord(key.pattern.toString(), value) : CreateRecord(StringKey, value);
  }


  function FromTemplateKey(pattern, value) {
    const types2 = ParsePatternIntoTypes(pattern);
    const finite = IsTemplateLiteralFinite(types2);
    const result = finite ? FromKey(EvaluateTemplateLiteral(pattern), value) : CreateRecord(pattern, value);
    return result;
  }


  function FlattenType(type2) {
    const result = IsUnion(type2) ? Flatten(type2.anyOf) : [type2];
    return result;
  }
  function Flatten(types2, result = []) {
    return guard_exports.ShiftLeft(types2, (left, right) => Flatten(right, [...result, ...FlattenType(left)]), () => result);
  }


  function StringOrNumberCheck(types2) {
    return types2.some((type2) => IsString4(type2) || IsNumber4(type2) || IsInteger3(type2));
  }
  function TryBuildRecord(types2, value) {
    return guard_exports.IsEqual(StringOrNumberCheck(types2), true) ? CreateRecord(StringKey, value) : void 0;
  }
  function CreateProperties(types2, value) {
    return types2.reduce((result, left) => {
      return IsLiteral(left) && (guard_exports.IsString(left.const) || guard_exports.IsNumber(left.const)) ? { ...result, [left.const]: value } : result;
    }, {});
  }
  function CreateObject(types2, value) {
    const properties = CreateProperties(types2, value);
    const result = _Object_(properties);
    return result;
  }
  function FromUnionKey(types2, value) {
    const flattened = Flatten(types2);
    const record = TryBuildRecord(flattened, value);
    return IsSchema(record) ? record : CreateObject(flattened, value);
  }


  function FromKey(key, value) {
    const result = IsAny(key) ? FromAnyKey(value) : IsBoolean4(key) ? FromBooleanKey(value) : IsEnum(key) ? FromEnumKey(key.enum, value) : IsInteger3(key) ? FromIntegerKey(key, value) : IsIntersect(key) ? FromIntersectKey(key.allOf, value) : IsLiteral(key) ? FromLiteralKey(key.const, value) : IsNumber4(key) ? FromNumberKey(key, value) : IsUnion(key) ? FromUnionKey(key.anyOf, value) : IsString4(key) ? FromStringKey(key, value) : IsTemplateLiteral(key) ? FromTemplateKey(key.pattern, value) : _Object_({});
    return result;
  }


  function RecordAction(key, value, options) {
    const result = CanInstantiate([key]) ? memory_exports.Update(FromKey(key, value), {}, options) : RecordDeferred(key, value, options);
    return result;
  }
  function RecordInstantiate(context, state2, key, value, options) {
    const instantiatedKey = InstantiateType(context, state2, key);
    const instantiatedValue = InstantiateType(context, state2, value);
    return RecordAction(instantiatedKey, instantiatedValue, options);
  }


  var IntegerKey = `^${IntegerPattern}$`;
  var NumberKey = `^${NumberPattern}$`;
  var StringKey = `^${StringPattern}$`;
  function RecordDeferred(key, value, options = {}) {
    return Deferred("Record", [key, value], options);
  }
  function Record(key, value, options = {}) {
    return RecordAction(key, value, options);
  }
  function RecordFromPattern(pattern, value) {
    return CreateRecord(pattern, value);
  }
  function RecordPatternToType(pattern) {
    const result = guard_exports.IsEqual(pattern, StringKey) ? String2() : guard_exports.IsEqual(pattern, IntegerKey) ? Integer() : guard_exports.IsEqual(pattern, NumberKey) ? Number2() : TemplateLiteralDecodeUnsafe(pattern);
    return result;
  }
  function RecordPattern(type2) {
    return guard_exports.Keys(type2.patternProperties)[0];
  }
  function RecordKey(type2) {
    const pattern = RecordPattern(type2);
    const result = RecordPatternToType(pattern);
    return result;
  }
  function RecordValue(type2) {
    return type2.patternProperties[RecordPattern(type2)];
  }
  function IsRecord(value) {
    return IsKind(value, "Record");
  }
  function RecordOptions(type2) {
    return memory_exports.Discard(type2, ["~kind", "type", "patternProperties"]);
  }


  function Rest(type2) {
    return memory_exports.Create({ "~kind": "Rest" }, { type: "rest", items: type2 }, {});
  }
  function IsRest(value) {
    return IsKind(value, "Rest");
  }


  function This(options) {
    return memory_exports.Create({ ["~kind"]: "This" }, { $ref: "#" }, options);
  }
  function IsThis(value) {
    return IsKind(value, "This");
  }


  function Undefined(options) {
    return memory_exports.Create({ "~kind": "Undefined" }, { type: "undefined" }, options);
  }
  function IsUndefined3(value) {
    return IsKind(value, "Undefined");
  }


  function Void(options) {
    return memory_exports.Create({ "~kind": "Void" }, { type: "void" }, options);
  }
  function IsVoid(value) {
    return IsKind(value, "Void");
  }


  function IntrinsicOrCall(ref, parameters) {
    return guard_exports.IsEqual(ref, "Array") ? _Array_(parameters[0]) : guard_exports.IsEqual(ref, "Capitalize") ? CapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ConstructorParameters") ? ConstructorParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Evaluate") ? EvaluateDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Exclude") ? ExcludeDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Extract") ? ExtractDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Index") ? IndexDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "InstanceType") ? InstanceTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Lowercase") ? LowercaseDeferred(parameters[0]) : guard_exports.IsEqual(ref, "NonNullable") ? NonNullableDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Omit") ? OmitDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Parameters") ? ParametersDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Partial") ? PartialDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Pick") ? PickDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Readonly") ? ReadonlyObjectDeferred(parameters[0]) : guard_exports.IsEqual(ref, "KeyOf") ? KeyOfDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Record") ? RecordDeferred(parameters[0], parameters[1]) : guard_exports.IsEqual(ref, "Required") ? RequiredDeferred(parameters[0]) : guard_exports.IsEqual(ref, "ReturnType") ? ReturnTypeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uncapitalize") ? UncapitalizeDeferred(parameters[0]) : guard_exports.IsEqual(ref, "Uppercase") ? UppercaseDeferred(parameters[0]) : CallConstruct(Ref(ref), parameters);
  }
  function Unreachable2() {
    throw Error("Unreachable");
  }
  function DelimitedDecode(input, result = []) {
    return guard_exports.ShiftLeft(input, (left, right) => DelimitedDecode(right, [...result, left[1]]), () => result);
  }
  function Delimited(input) {
    return guard_exports.IsEqual(input.length, 3) ? [input[0], ...DelimitedDecode(input[1])] : [];
  }
  function GenericParameterExtendsEqualsMapping(input) {
    return Parameter(input[0], input[2], input[4]);
  }
  function GenericParameterExtendsMapping(input) {
    return Parameter(input[0], input[2], input[2]);
  }
  function GenericParameterEqualsMapping(input) {
    return Parameter(input[0], Unknown(), input[2]);
  }
  function GenericParameterIdentifierMapping(input) {
    return Parameter(input, Unknown(), Unknown());
  }
  function GenericParameterMapping(input) {
    return input;
  }
  function GenericParameterListMapping(input) {
    return Delimited(input);
  }
  function GenericParametersMapping(input) {
    return input[1];
  }
  function GenericCallArgumentListMapping(input) {
    return Delimited(input);
  }
  function GenericCallArgumentsMapping(input) {
    return input[1];
  }
  function GenericCallMapping(input) {
    return IntrinsicOrCall(input[0], input[1]);
  }
  function OptionalSemiColonMapping(input) {
    return null;
  }
  function KeywordStringMapping(input) {
    return String2();
  }
  function KeywordNumberMapping(input) {
    return Number2();
  }
  function KeywordBooleanMapping(input) {
    return Boolean2();
  }
  function KeywordUndefinedMapping(input) {
    return Undefined();
  }
  function KeywordNullMapping(input) {
    return Null();
  }
  function KeywordIntegerMapping(input) {
    return Integer();
  }
  function KeywordBigIntMapping(input) {
    return BigInt2();
  }
  function KeywordUnknownMapping(input) {
    return Unknown();
  }
  function KeywordAnyMapping(input) {
    return Any();
  }
  function KeywordObjectMapping(input) {
    return _Object_({});
  }
  function KeywordNeverMapping(input) {
    return Never();
  }
  function KeywordSymbolMapping(input) {
    return Symbol2();
  }
  function KeywordVoidMapping(input) {
    return Void();
  }
  function KeywordThisMapping(input) {
    return This();
  }
  function LiteralBigIntMapping(input) {
    return Literal(BigInt(input));
  }
  function LiteralBooleanMapping(input) {
    return Literal(guard_exports.IsEqual(input, "true"));
  }
  function LiteralNumberMapping(input) {
    return Literal(parseFloat(input));
  }
  function LiteralStringMapping(input) {
    return Literal(input);
  }
  function TemplateInterpolateMapping(input) {
    return input[1];
  }
  function TemplateSpanMapping(input) {
    return Literal(input);
  }
  function TemplateBodyMapping(input) {
    return guard_exports.IsEqual(input.length, 3) ? [input[0], input[1], ...input[2]] : [input[0]];
  }
  function TemplateLiteralTypesMapping(input) {
    return input[1];
  }
  function TemplateLiteralMapping(input) {
    return TemplateLiteralDeferred(input);
  }
  function DependentMapping(input) {
    return guard_exports.IsEqual(input.length, 6) ? Dependent(input[1], input[3], input[5]) : Dependent(input[1], input[3], Unknown());
  }
  function KeyOfMapping(input) {
    return input.length > 0;
  }
  function IndexArrayMapping(input) {
    return input.reduce((result, current) => {
      return guard_exports.IsEqual(current.length, 3) ? [...result, [current[1]]] : [...result, []];
    }, []);
  }
  function ExtendsMapping(input) {
    return guard_exports.IsEqual(input.length, 6) ? [input[1], input[3], input[5]] : [];
  }
  function BaseMapping(input) {
    return guard_exports.IsArray(input) && guard_exports.IsEqual(input.length, 3) ? input[1] : input;
  }
  function WithMapping(input) {
    return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
  }
  function FactorIndexArray(Type2, indexArray) {
    return indexArray.reduce((result, left) => {
      const _left = left;
      return guard_exports.IsEqual(_left.length, 1) ? IndexDeferred(result, _left[0]) : guard_exports.IsEqual(_left.length, 0) ? _Array_(result) : Unreachable2();
    }, Type2);
  }
  function FactorExtends(type2, extend) {
    return guard_exports.IsEqual(extend.length, 3) ? ConditionalDeferred(type2, extend[0], extend[1], extend[2]) : type2;
  }
  function FactorWith(type2, withClause) {
    return guard_exports.IsArray(withClause) && guard_exports.IsEqual(withClause.length, 0) ? type2 : WithDeferred(type2, withClause);
  }
  function FactorMapping(input) {
    const [keyOf, type2, indexArray, extend, withClause] = input;
    return FactorWith(keyOf ? FactorExtends(KeyOfDeferred(FactorIndexArray(type2, indexArray)), extend) : FactorExtends(FactorIndexArray(type2, indexArray), extend), withClause);
  }
  function ExprBinaryMapping(left, rest) {
    return guard_exports.IsEqual(rest.length, 3) ? (() => {
      const [operator, right, next] = rest;
      const Schema = ExprBinaryMapping(right, next);
      if (guard_exports.IsEqual(operator, "&")) {
        return IsIntersect(Schema) ? Intersect([left, ...Schema.allOf]) : Intersect([left, Schema]);
      }
      if (guard_exports.IsEqual(operator, "|")) {
        return IsUnion(Schema) ? Union([left, ...Schema.anyOf]) : Union([left, Schema]);
      }
      Unreachable2();
    })() : left;
  }
  function ExprTermTailMapping(input) {
    return input;
  }
  function ExprTermMapping(input) {
    const [left, rest] = input;
    return ExprBinaryMapping(left, rest);
  }
  function ExprTailMapping(input) {
    return input;
  }
  function ExprMapping(input) {
    const [left, rest] = input;
    return ExprBinaryMapping(left, rest);
  }
  function ExprReadonlyMapping(input) {
    return AddImmutableDeferred(input[1]);
  }
  function ExprPipeMapping(input) {
    return input[1];
  }
  function GenericTypeMapping(input) {
    return Generic(input[0], input[2]);
  }
  function InferTypeMapping(input) {
    return guard_exports.IsEqual(input.length, 4) ? Infer(input[1], input[3]) : guard_exports.IsEqual(input.length, 2) ? Infer(input[1], Unknown()) : Unreachable2();
  }
  function TypeMapping(input) {
    return input;
  }
  function PropertyKeyNumberMapping(input) {
    return `${input}`;
  }
  function PropertyKeyIdentMapping(input) {
    return input;
  }
  function PropertyKeyQuotedMapping(input) {
    return input;
  }
  function PropertyKeyIndexMapping(input) {
    return IsInteger3(input[3]) ? IntegerKey : IsNumber4(input[3]) ? NumberKey : IsSymbol3(input[3]) ? StringKey : IsString4(input[3]) ? StringKey : Unreachable2();
  }
  function PropertyKeyMapping(input) {
    return input;
  }
  function ReadonlyMapping(input) {
    return input.length > 0;
  }
  function OptionalMapping(input) {
    return input.length > 0;
  }
  function PropertyMapping(input) {
    const [isReadonly, key, isOptional, _colon, type2] = input;
    return {
      [key]: isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type2)) : isReadonly && !isOptional ? AddReadonlyDeferred(type2) : !isReadonly && isOptional ? AddOptionalDeferred(type2) : type2
    };
  }
  function PropertyDelimiterMapping(input) {
    return input;
  }
  function PropertyListMapping(input) {
    return Delimited(input);
  }
  function PropertiesReduce(propertyList) {
    return propertyList.reduce((result, left) => {
      const isPatternProperties = guard_exports.HasPropertyKey(left, IntegerKey) || guard_exports.HasPropertyKey(left, NumberKey) || guard_exports.HasPropertyKey(left, StringKey);
      return isPatternProperties ? [result[0], memory_exports.Assign(result[1], left)] : [memory_exports.Assign(result[0], left), result[1]];
    }, [{}, {}]);
  }
  function PropertiesMapping(input) {
    return PropertiesReduce(input[1]);
  }
  function _Object_Mapping(input) {
    const [properties, patternProperties] = input;
    const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
    return _Object_(properties, options);
  }
  function ElementNamedMapping(input) {
    return guard_exports.IsEqual(input.length, 5) ? AddReadonlyDeferred(AddOptionalDeferred(input[4])) : guard_exports.IsEqual(input.length, 3) ? input[2] : guard_exports.IsEqual(input.length, 4) ? guard_exports.IsEqual(input[2], "readonly") ? AddReadonlyDeferred(input[3]) : AddOptionalDeferred(input[3]) : Unreachable2();
  }
  function ElementBaseMapping(input) {
    if (!guard_exports.IsArray(input) || !guard_exports.IsEqual(input.length, 3))
      return input;
    const [isReadonly, type2, isOptional] = input;
    return isReadonly && isOptional ? AddReadonlyDeferred(AddOptionalDeferred(type2)) : isReadonly && !isOptional ? AddReadonlyDeferred(type2) : !isReadonly && isOptional ? AddOptionalDeferred(type2) : type2;
  }
  function ElementMapping(input) {
    return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
  }
  function ElementListMapping(input) {
    return Delimited(input);
  }
  function _Tuple_Mapping(input) {
    return Tuple(input[1]);
  }
  function ParameterReadonlyOptionalMapping(input) {
    return AddReadonlyDeferred(AddOptionalDeferred(input[4]));
  }
  function ParameterReadonlyMapping(input) {
    return AddReadonlyDeferred(input[3]);
  }
  function ParameterOptionalMapping(input) {
    return AddOptionalDeferred(input[3]);
  }
  function ParameterTypeMapping(input) {
    return input[2];
  }
  function ParameterBaseMapping(input) {
    return input;
  }
  function ParameterMapping(input) {
    return guard_exports.IsEqual(input.length, 2) ? Rest(input[1]) : guard_exports.IsEqual(input.length, 1) ? input[0] : Unreachable2();
  }
  function ParameterListMapping(input) {
    return Delimited(input);
  }
  function _Function_Mapping(input) {
    return _Function_(input[1], input[4]);
  }
  function _Constructor_Mapping(input) {
    return Constructor(input[2], input[5]);
  }
  function ApplyReadonly(state2, type2) {
    return guard_exports.IsEqual(state2, "remove") ? RemoveReadonlyDeferred(type2) : guard_exports.IsEqual(state2, "add") ? AddReadonlyDeferred(type2) : type2;
  }
  function MappedReadonlyMapping(input) {
    return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
  }
  function ApplyOptional(state2, type2) {
    return guard_exports.IsEqual(state2, "remove") ? RemoveOptionalDeferred(type2) : guard_exports.IsEqual(state2, "add") ? AddOptionalDeferred(type2) : type2;
  }
  function MappedOptionalMapping(input) {
    return guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "-") ? "remove" : guard_exports.IsEqual(input.length, 2) && guard_exports.IsEqual(input[0], "+") ? "add" : guard_exports.IsEqual(input.length, 1) ? "add" : "none";
  }
  function MappedAsMapping(input) {
    return guard_exports.IsEqual(input.length, 2) ? [input[1]] : [];
  }
  function _Mapped_Mapping(input) {
    return guard_exports.IsArray(input[6]) && guard_exports.IsEqual(input[6].length, 1) ? MappedDeferred(Identifier(input[3]), input[5], input[6][0], ApplyReadonly(input[1], ApplyOptional(input[8], input[10]))) : MappedDeferred(Identifier(input[3]), input[5], Ref(input[3]), ApplyReadonly(input[1], ApplyOptional(input[8], input[10])));
  }
  function ReferenceMapping(input) {
    return Ref(input);
  }
  function WithBigIntMapping(input) {
    return BigInt(input);
  }
  function WithNumberMapping(input) {
    return parseFloat(input);
  }
  function WithBooleanMapping(input) {
    return guard_exports.IsEqual(input, "true");
  }
  function WithStringMapping(input) {
    return input;
  }
  function WithNullMapping(input) {
    return null;
  }
  function WithUndefinedMapping(input) {
    return void 0;
  }
  function WithPropertyMapping(input) {
    return { [input[0]]: input[2] };
  }
  function WithPropertyListMapping(input) {
    return Delimited(input);
  }
  function WithObjectMappingReduce(propertyList) {
    return propertyList.reduce((result, left) => {
      return memory_exports.Assign(result, left);
    }, {});
  }
  function WithObjectMapping(input) {
    return WithObjectMappingReduce(input[1]);
  }
  function WithElementListMapping(input) {
    return Delimited(input);
  }
  function WithArrayMapping(input) {
    return input[1];
  }
  function WithValueMapping(input) {
    return input;
  }
  function PatternBigIntMapping(input) {
    return BigInt2();
  }
  function PatternStringMapping(input) {
    return String2();
  }
  function PatternNumberMapping(input) {
    return Number2();
  }
  function PatternIntegerMapping(input) {
    return Integer();
  }
  function PatternNeverMapping(input) {
    return Never();
  }
  function PatternTextMapping(input) {
    return Literal(input);
  }
  function PatternBaseMapping(input) {
    return input;
  }
  function PatternGroupMapping(input) {
    return Union(input[1]);
  }
  function PatternUnionMapping(input) {
    return input.length === 3 ? [...input[0], ...input[2]] : input.length === 1 ? [...input[0]] : [];
  }
  function PatternTermMapping(input) {
    return [input[0], ...input[1]];
  }
  function PatternBodyMapping(input) {
    return input;
  }
  function PatternMapping(input) {
    return input[1];
  }
  function InterfaceDeclarationHeritageListMapping(input) {
    return Delimited(input);
  }
  function InterfaceDeclarationHeritageMapping(input) {
    return guard_exports.IsEqual(input.length, 2) ? input[1] : [];
  }
  function InterfaceDeclarationGenericMapping(input) {
    const parameters = input[2];
    const heritage = input[3];
    const [properties, patternProperties] = input[4];
    const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
    return { [input[1]]: Generic(parameters, InterfaceDeferred(heritage, properties, options)) };
  }
  function InterfaceDeclarationMapping(input) {
    const heritage = input[2];
    const [properties, patternProperties] = input[3];
    const options = guard_exports.IsEqual(guard_exports.Keys(patternProperties).length, 0) ? {} : { patternProperties };
    return { [input[1]]: InterfaceDeferred(heritage, properties, options) };
  }
  function TypeAliasDeclarationGenericMapping(input) {
    return { [input[1]]: Generic(input[2], input[4]) };
  }
  function TypeAliasDeclarationMapping(input) {
    return { [input[1]]: input[3] };
  }
  function ExportKeywordMapping(input) {
    return null;
  }
  function ModuleDeclarationDelimiterMapping(input) {
    return input;
  }
  function ModuleDeclarationListMapping(input) {
    return Delimited(input);
  }
  function ModuleDeclarationMapping(input) {
    return input[1];
  }
  function ModuleMapping(input) {
    const [moduleDeclaration, moduleDeclarationList] = [input[0], input[1]];
    return ModuleDeferred(memory_exports.Assign(moduleDeclaration, PropertiesReduce(moduleDeclarationList)[0]));
  }
  function ScriptMapping(input) {
    return input;
  }


  function IsMatch(value) {
    return IsEqual(value.length, 2);
  }
  function Match2(input, ok2, fail2) {
    return IsMatch(input) ? ok2(input[0], input[1]) : fail2();
  }


  function TakeVariant(variant2, input) {
    return IsEqual(input.indexOf(variant2), 0) ? [variant2, input.slice(variant2.length)] : [];
  }
  function Take(variants, input) {
    for (let i = 0; i < variants.length; i++) {
      const result = TakeVariant(variants[i], input);
      if (IsMatch(result))
        return result;
    }
    return [];
  }


  function Range(start2, end) {
    return Array.from({ length: end - start2 + 1 }, (_, i) => String.fromCharCode(start2 + i));
  }
  var Alpha = [
    ...Range(97, 122),
    // Lowercase
    ...Range(65, 90)
    // Uppercase
  ];
  var Zero = "0";
  var NonZero = Range(49, 57);
  var Digit = [Zero, ...NonZero];
  var WhiteSpace = " ";
  var NewLine = "\n";
  var UnderScore = "_";
  var Dot = ".";
  var DollarSign = "$";
  var Hyphen = "-";


  var LineComment = "//";
  var OpenComment = "/*";
  var CloseComment = "*/";
  function DiscardMultilineComment(input) {
    const index3 = input.indexOf(CloseComment);
    const result = IsEqual(index3, -1) ? "" : input.slice(index3 + 2);
    return result;
  }
  function DiscardLineComment(input) {
    const index3 = input.indexOf(NewLine);
    const result = IsEqual(index3, -1) ? "" : input.slice(index3);
    return result;
  }
  function TrimStartUntilNewline(input) {
    return input.replace(/^[ \t\r\f\v]+/, "");
  }
  function TrimWhitespace(input) {
    const trimmed = TrimStartUntilNewline(input);
    return trimmed.startsWith(OpenComment) ? TrimWhitespace(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? TrimWhitespace(DiscardLineComment(trimmed.slice(2))) : trimmed;
  }
  function Trim(input) {
    const trimmed = input.trimStart();
    return trimmed.startsWith(OpenComment) ? Trim(DiscardMultilineComment(trimmed.slice(2))) : trimmed.startsWith(LineComment) ? Trim(DiscardLineComment(trimmed.slice(2))) : trimmed;
  }


  function Optional2(value, input) {
    return Match2(Take([value], input), (Optional4, Rest2) => [Optional4, Rest2], () => ["", input]);
  }


  function IsDiscard(discard, input) {
    return discard.includes(input);
  }
  function Many(allowed, discard, input, result = "") {
    return Match2(Take(allowed, input), (Char, Rest2) => IsDiscard(discard, Char) ? Many(allowed, discard, Rest2, result) : Many(allowed, discard, Rest2, `${result}${Char}`), () => [result, input]);
  }


  function TakeNonZero(input) {
    return Take(NonZero, input);
  }
  var AllowedDigits = [...Digit, UnderScore];
  function TakeDigits(input) {
    return Many(AllowedDigits, [UnderScore], input);
  }
  function TakeUnsignedInteger(input) {
    return Match2(Take([Zero], input), (Zero2, ZeroRest) => [Zero2, ZeroRest], () => Match2(
      TakeNonZero(input),
      (NonZero2, NonZeroRest) => Match2(TakeDigits(NonZeroRest), (Digits, DigitsRest) => [`${NonZero2}${Digits}`, DigitsRest], () => []),
      // fail: did not match Digits
      () => []
    ));
  }
  function UnsignedInteger(input) {
    return TakeUnsignedInteger(Trim(input));
  }


  function TakeSign(input) {
    return Optional2(Hyphen, input);
  }
  function TakeSignedInteger(input) {
    return Match2(
      TakeSign(input),
      (Sign, SignRest) => Match2(UnsignedInteger(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
      // fail: did not match unsigned integer
      () => []
    );
  }
  function Integer2(input) {
    return TakeSignedInteger(Trim(input));
  }


  function TakeBigInt(input) {
    return Match2(
      Integer2(input),
      (Integer3, IntegerRest) => Match2(Take(["n"], IntegerRest), (_N, NRest) => [`${Integer3}`, NRest], () => []),
      // fail: did not match 'n'
      () => []
    );
  }
  function BigInt3(input) {
    return TakeBigInt(input);
  }


  function TakeConst(const_, input) {
    return Take([const_], input);
  }
  function Const(const_, input) {
    return IsEqual(const_, "") ? ["", input] : const_.startsWith(NewLine) ? TakeConst(const_, TrimWhitespace(input)) : const_.startsWith(WhiteSpace) ? TakeConst(const_, input) : TakeConst(const_, Trim(input));
  }


  var Initial = [...Alpha, UnderScore, DollarSign];
  function TakeInitial(input) {
    return Take(Initial, input);
  }
  var Remaining = [...Initial, ...Digit];
  function TakeRemaining(input, result = "") {
    return Match2(Take(Remaining, input), (Remaining2, RemainingRest) => TakeRemaining(RemainingRest, `${result}${Remaining2}`), () => [result, input]);
  }
  function TakeIdent(input) {
    return Match2(
      TakeInitial(input),
      (Initial2, InitialRest) => Match2(TakeRemaining(InitialRest), (Remaining2, RemainingRest) => [`${Initial2}${Remaining2}`, RemainingRest], () => []),
      // fail: did not match Remaining
      () => []
    );
  }
  function Ident(input) {
    return TakeIdent(Trim(input));
  }


  var AllowedDigits2 = [...Digit, UnderScore];
  function IsLeadingDot(input) {
    return IsMatch(Take([Dot], input));
  }
  function TakeFractional(input) {
    return Match2(Many(AllowedDigits2, [UnderScore], input), (Digits, DigitsRest) => IsEqual(Digits, "") ? [] : [Digits, DigitsRest], () => []);
  }
  function LeadingDot(input) {
    return Match2(
      Take([Dot], input),
      (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`0${Dot2}${Fractional}`, FractionalRest], () => []),
      // fail: did not match Fractional
      () => []
    );
  }
  function LeadingInteger(input) {
    return Match2(
      UnsignedInteger(input),
      (Integer3, IntegerRest) => Match2(
        Take([Dot], IntegerRest),
        (Dot2, DotRest) => Match2(TakeFractional(DotRest), (Fractional, FractionalRest) => [`${Integer3}${Dot2}${Fractional}`, FractionalRest], () => [`${Integer3}`, DotRest]),
        // fail: did not match Fractional, use Integer
        () => [`${Integer3}`, IntegerRest]
      ),
      // fail: did not match Dot, use Integer
      () => []
    );
  }
  function TakeUnsignedNumber(input) {
    return IsLeadingDot(input) ? LeadingDot(input) : LeadingInteger(input);
  }
  function UnsignedNumber(input) {
    return TakeUnsignedNumber(Trim(input));
  }


  function TakeSign2(input) {
    return Optional2(Hyphen, input);
  }
  function TakeSignedNumber(input) {
    return Match2(
      TakeSign2(input),
      (Sign, SignRest) => Match2(UnsignedNumber(SignRest), (UnsignedInteger2, UnsignedIntegerRest) => [`${Sign}${UnsignedInteger2}`, UnsignedIntegerRest], () => []),
      // fail: did not match unsigned integer
      () => []
    );
  }
  function Number3(input) {
    return TakeSignedNumber(Trim(input));
  }


  function TakeOne(input) {
    const result = IsEqual(input, "") ? [] : [input.slice(0, 1), input.slice(1)];
    return result;
  }
  function IsInputMatchSentinal(end, input) {
    return ShiftLeft(end, (left, right) => input.startsWith(left) ? true : IsInputMatchSentinal(right, input), () => false);
  }
  function Until(end, input, result = "") {
    return Match2(
      TakeOne(input),
      (One, Rest2) => IsInputMatchSentinal(end, input) ? [result, input] : Until(end, Rest2, `${result}${One}`),
      () => []
    );
  }


  function MultiLine(start2, end, input) {
    return Match2(
      Take([start2], input),
      (_, Rest2) => Match2(
        Until([end], Rest2),
        (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, Rest3) => [`${Until2}`, Rest3], () => []),
        // fail: did not match End
        () => []
      ),
      // fail: did not match Until
      () => []
    );
  }
  function SingleLine(start2, end, input) {
    return Match2(
      Take([start2], input),
      (_, Rest2) => Match2(
        Until([NewLine, end], Rest2),
        (Until2, UntilRest) => Match2(Take([end], UntilRest), (_2, EndRest) => [`${Until2}`, EndRest], () => []),
        // fail: did not match End
        () => []
      ),
      // fail: did not match Until
      () => []
    );
  }
  function Span(start2, end, multiLine, input) {
    return multiLine ? MultiLine(start2, end, Trim(input)) : SingleLine(start2, end, Trim(input));
  }


  function TakeInitial2(quotes, input) {
    return Take(quotes, input);
  }
  function TakeSpan(quote, input) {
    return Span(quote, quote, false, input);
  }
  function TakeString(quotes, input) {
    return Match2(TakeInitial2(quotes, input), (Initial2, InitialRest) => TakeSpan(Initial2, `${Initial2}${InitialRest}`), () => []);
  }
  function String3(quotes, input) {
    return TakeString(quotes, Trim(input));
  }


  function Until_1(end, input) {
    return Match2(Until(end, input), (Until2, UntilRest) => IsEqual(Until2, "") ? [] : [Until2, UntilRest], () => []);
  }


  var If2 = (result, left, right = () => []) => result.length === 2 ? left(result) : right();
  var GenericParameterExtendsEquals = (input) => If2(If2(Ident(input), ([_0, input2]) => If2(Const("extends", input2), ([_1, input3]) => If2(Type(input3), ([_2, input4]) => If2(Const("=", input4), ([_3, input5]) => If2(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [GenericParameterExtendsEqualsMapping(_0), input2]);
  var GenericParameterExtends = (input) => If2(If2(Ident(input), ([_0, input2]) => If2(Const("extends", input2), ([_1, input3]) => If2(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterExtendsMapping(_0), input2]);
  var GenericParameterEquals = (input) => If2(If2(Ident(input), ([_0, input2]) => If2(Const("=", input2), ([_1, input3]) => If2(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParameterEqualsMapping(_0), input2]);
  var GenericParameterIdentifier = (input) => If2(Ident(input), ([_0, input2]) => [GenericParameterIdentifierMapping(_0), input2]);
  var GenericParameter = (input) => If2(If2(GenericParameterExtendsEquals(input), ([_0, input2]) => [_0, input2], () => If2(GenericParameterExtends(input), ([_0, input2]) => [_0, input2], () => If2(GenericParameterEquals(input), ([_0, input2]) => [_0, input2], () => If2(GenericParameterIdentifier(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [GenericParameterMapping(_0), input2]);
  var GenericParameterList_0 = (input, result = []) => If2(If2(Const(",", input), ([_0, input2]) => If2(GenericParameter(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericParameterList_0(input2, [...result, _0]), () => [result, input]);
  var GenericParameterList = (input) => If2(If2(If2(GenericParameter(input), ([_0, input2]) => If2(GenericParameterList_0(input2), ([_1, input3]) => If2(If2(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [GenericParameterListMapping(_0), input2]);
  var GenericParameters = (input) => If2(If2(Const("<", input), ([_0, input2]) => If2(GenericParameterList(input2), ([_1, input3]) => If2(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericParametersMapping(_0), input2]);
  var GenericCallArgumentList_0 = (input, result = []) => If2(If2(Const(",", input), ([_0, input2]) => If2(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => GenericCallArgumentList_0(input2, [...result, _0]), () => [result, input]);
  var GenericCallArgumentList = (input) => If2(If2(If2(Type(input), ([_0, input2]) => If2(GenericCallArgumentList_0(input2), ([_1, input3]) => If2(If2(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [GenericCallArgumentListMapping(_0), input2]);
  var GenericCallArguments = (input) => If2(If2(Const("<", input), ([_0, input2]) => If2(GenericCallArgumentList(input2), ([_1, input3]) => If2(Const(">", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericCallArgumentsMapping(_0), input2]);
  var GenericCall = (input) => If2(If2(Ident(input), ([_0, input2]) => If2(GenericCallArguments(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [GenericCallMapping(_0), input2]);
  var OptionalSemiColon = (input) => If2(If2(If2(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalSemiColonMapping(_0), input2]);
  var KeywordString = (input) => If2(Const("string", input), ([_0, input2]) => [KeywordStringMapping(_0), input2]);
  var KeywordNumber = (input) => If2(Const("number", input), ([_0, input2]) => [KeywordNumberMapping(_0), input2]);
  var KeywordBoolean = (input) => If2(Const("boolean", input), ([_0, input2]) => [KeywordBooleanMapping(_0), input2]);
  var KeywordUndefined = (input) => If2(Const("undefined", input), ([_0, input2]) => [KeywordUndefinedMapping(_0), input2]);
  var KeywordNull = (input) => If2(Const("null", input), ([_0, input2]) => [KeywordNullMapping(_0), input2]);
  var KeywordInteger = (input) => If2(Const("integer", input), ([_0, input2]) => [KeywordIntegerMapping(_0), input2]);
  var KeywordBigInt = (input) => If2(Const("bigint", input), ([_0, input2]) => [KeywordBigIntMapping(_0), input2]);
  var KeywordUnknown = (input) => If2(Const("unknown", input), ([_0, input2]) => [KeywordUnknownMapping(_0), input2]);
  var KeywordAny = (input) => If2(Const("any", input), ([_0, input2]) => [KeywordAnyMapping(_0), input2]);
  var KeywordObject = (input) => If2(Const("object", input), ([_0, input2]) => [KeywordObjectMapping(_0), input2]);
  var KeywordNever = (input) => If2(Const("never", input), ([_0, input2]) => [KeywordNeverMapping(_0), input2]);
  var KeywordSymbol = (input) => If2(Const("symbol", input), ([_0, input2]) => [KeywordSymbolMapping(_0), input2]);
  var KeywordVoid = (input) => If2(Const("void", input), ([_0, input2]) => [KeywordVoidMapping(_0), input2]);
  var KeywordThis = (input) => If2(Const("this", input), ([_0, input2]) => [KeywordThisMapping(_0), input2]);
  var TemplateInterpolate = (input) => If2(If2(Const("${", input), ([_0, input2]) => If2(Type(input2), ([_1, input3]) => If2(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateInterpolateMapping(_0), input2]);
  var TemplateSpan = (input) => If2(Until(["${", "`"], input), ([_0, input2]) => [TemplateSpanMapping(_0), input2]);
  var TemplateBody = (input) => If2(If2(If2(TemplateSpan(input), ([_0, input2]) => If2(TemplateInterpolate(input2), ([_1, input3]) => If2(TemplateBody(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2(If2(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2(If2(TemplateSpan(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [TemplateBodyMapping(_0), input2]);
  var TemplateLiteralTypes = (input) => If2(If2(Const("`", input), ([_0, input2]) => If2(TemplateBody(input2), ([_1, input3]) => If2(Const("`", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [TemplateLiteralTypesMapping(_0), input2]);
  var TemplateLiteral = (input) => If2(TemplateLiteralTypes(input), ([_0, input2]) => [TemplateLiteralMapping(_0), input2]);
  var Dependent2 = (input) => If2(If2(If2(Const("if", input), ([_0, input2]) => If2(Type(input2), ([_1, input3]) => If2(Const("then", input3), ([_2, input4]) => If2(Type(input4), ([_3, input5]) => If2(Const("else", input5), ([_4, input6]) => If2(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If2(If2(Const("if", input), ([_0, input2]) => If2(Type(input2), ([_1, input3]) => If2(Const("then", input3), ([_2, input4]) => If2(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [DependentMapping(_0), input2]);
  var LiteralBigInt = (input) => If2(BigInt3(input), ([_0, input2]) => [LiteralBigIntMapping(_0), input2]);
  var LiteralBoolean = (input) => If2(If2(Const("true", input), ([_0, input2]) => [_0, input2], () => If2(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [LiteralBooleanMapping(_0), input2]);
  var LiteralNumber = (input) => If2(Number3(input), ([_0, input2]) => [LiteralNumberMapping(_0), input2]);
  var LiteralString = (input) => If2(String3(["'", '"'], input), ([_0, input2]) => [LiteralStringMapping(_0), input2]);
  var KeyOf = (input) => If2(If2(If2(Const("keyof", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [KeyOfMapping(_0), input2]);
  var IndexArray_0 = (input, result = []) => If2(If2(If2(Const("[", input), ([_0, input2]) => If2(Type(input2), ([_1, input3]) => If2(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2(If2(Const("[", input), ([_0, input2]) => If2(Const("]", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => IndexArray_0(input2, [...result, _0]), () => [result, input]);
  var IndexArray = (input) => If2(IndexArray_0(input), ([_0, input2]) => [IndexArrayMapping(_0), input2]);
  var Extends2 = (input) => If2(If2(If2(Const("extends", input), ([_0, input2]) => If2(Type(input2), ([_1, input3]) => If2(Const("?", input3), ([_2, input4]) => If2(Type(input4), ([_3, input5]) => If2(Const(":", input5), ([_4, input6]) => If2(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExtendsMapping(_0), input2]);
  var Base = (input) => If2(If2(If2(Const("(", input), ([_0, input2]) => If2(Type(input2), ([_1, input3]) => If2(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2(KeywordString(input), ([_0, input2]) => [_0, input2], () => If2(KeywordNumber(input), ([_0, input2]) => [_0, input2], () => If2(KeywordBoolean(input), ([_0, input2]) => [_0, input2], () => If2(KeywordUndefined(input), ([_0, input2]) => [_0, input2], () => If2(KeywordNull(input), ([_0, input2]) => [_0, input2], () => If2(KeywordInteger(input), ([_0, input2]) => [_0, input2], () => If2(KeywordBigInt(input), ([_0, input2]) => [_0, input2], () => If2(KeywordUnknown(input), ([_0, input2]) => [_0, input2], () => If2(KeywordAny(input), ([_0, input2]) => [_0, input2], () => If2(KeywordObject(input), ([_0, input2]) => [_0, input2], () => If2(KeywordNever(input), ([_0, input2]) => [_0, input2], () => If2(KeywordSymbol(input), ([_0, input2]) => [_0, input2], () => If2(KeywordVoid(input), ([_0, input2]) => [_0, input2], () => If2(KeywordThis(input), ([_0, input2]) => [_0, input2], () => If2(LiteralBigInt(input), ([_0, input2]) => [_0, input2], () => If2(LiteralBoolean(input), ([_0, input2]) => [_0, input2], () => If2(LiteralNumber(input), ([_0, input2]) => [_0, input2], () => If2(LiteralString(input), ([_0, input2]) => [_0, input2], () => If2(TemplateLiteral(input), ([_0, input2]) => [_0, input2], () => If2(Dependent2(input), ([_0, input2]) => [_0, input2], () => If2(_Object_2(input), ([_0, input2]) => [_0, input2], () => If2(_Tuple_(input), ([_0, input2]) => [_0, input2], () => If2(_Constructor_(input), ([_0, input2]) => [_0, input2], () => If2(_Function_2(input), ([_0, input2]) => [_0, input2], () => If2(_Mapped_(input), ([_0, input2]) => [_0, input2], () => If2(GenericCall(input), ([_0, input2]) => [_0, input2], () => If2(Reference(input), ([_0, input2]) => [_0, input2], () => [])))))))))))))))))))))))))))), ([_0, input2]) => [BaseMapping(_0), input2]);
  var With = (input) => If2(If2(If2(Const("with", input), ([_0, input2]) => If2(WithObject(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithMapping(_0), input2]);
  var Factor = (input) => If2(If2(KeyOf(input), ([_0, input2]) => If2(Base(input2), ([_1, input3]) => If2(IndexArray(input3), ([_2, input4]) => If2(Extends2(input4), ([_3, input5]) => If2(With(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [FactorMapping(_0), input2]);
  var ExprTermTail = (input) => If2(If2(If2(Const("&", input), ([_0, input2]) => If2(Factor(input2), ([_1, input3]) => If2(ExprTermTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTermTailMapping(_0), input2]);
  var ExprTerm = (input) => If2(If2(Factor(input), ([_0, input2]) => If2(ExprTermTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprTermMapping(_0), input2]);
  var ExprTail = (input) => If2(If2(If2(Const("|", input), ([_0, input2]) => If2(ExprTerm(input2), ([_1, input3]) => If2(ExprTail(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExprTailMapping(_0), input2]);
  var Expr = (input) => If2(If2(ExprTerm(input), ([_0, input2]) => If2(ExprTail(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprMapping(_0), input2]);
  var ExprReadonly = (input) => If2(If2(Const("readonly", input), ([_0, input2]) => If2(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprReadonlyMapping(_0), input2]);
  var ExprPipe = (input) => If2(If2(Const("|", input), ([_0, input2]) => If2(Expr(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ExprPipeMapping(_0), input2]);
  var GenericType = (input) => If2(If2(GenericParameters(input), ([_0, input2]) => If2(Const("=", input2), ([_1, input3]) => If2(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [GenericTypeMapping(_0), input2]);
  var InferType = (input) => If2(If2(If2(Const("infer", input), ([_0, input2]) => If2(Ident(input2), ([_1, input3]) => If2(Const("extends", input3), ([_2, input4]) => If2(Expr(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If2(If2(Const("infer", input), ([_0, input2]) => If2(Ident(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InferTypeMapping(_0), input2]);
  var Type = (input) => If2(If2(InferType(input), ([_0, input2]) => [_0, input2], () => If2(ExprPipe(input), ([_0, input2]) => [_0, input2], () => If2(ExprReadonly(input), ([_0, input2]) => [_0, input2], () => If2(Expr(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [TypeMapping(_0), input2]);
  var PropertyKeyNumber = (input) => If2(Number3(input), ([_0, input2]) => [PropertyKeyNumberMapping(_0), input2]);
  var PropertyKeyIdent = (input) => If2(Ident(input), ([_0, input2]) => [PropertyKeyIdentMapping(_0), input2]);
  var PropertyKeyQuoted = (input) => If2(String3(["'", '"'], input), ([_0, input2]) => [PropertyKeyQuotedMapping(_0), input2]);
  var PropertyKeyIndex = (input) => If2(If2(Const("[", input), ([_0, input2]) => If2(Ident(input2), ([_1, input3]) => If2(Const(":", input3), ([_2, input4]) => If2(If2(KeywordInteger(input4), ([_02, input5]) => [_02, input5], () => If2(KeywordNumber(input4), ([_02, input5]) => [_02, input5], () => If2(KeywordString(input4), ([_02, input5]) => [_02, input5], () => If2(KeywordSymbol(input4), ([_02, input5]) => [_02, input5], () => [])))), ([_3, input5]) => If2(Const("]", input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyKeyIndexMapping(_0), input2]);
  var PropertyKey = (input) => If2(If2(PropertyKeyNumber(input), ([_0, input2]) => [_0, input2], () => If2(PropertyKeyIdent(input), ([_0, input2]) => [_0, input2], () => If2(PropertyKeyQuoted(input), ([_0, input2]) => [_0, input2], () => If2(PropertyKeyIndex(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [PropertyKeyMapping(_0), input2]);
  var Readonly2 = (input) => If2(If2(If2(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ReadonlyMapping(_0), input2]);
  var Optional3 = (input) => If2(If2(If2(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [OptionalMapping(_0), input2]);
  var Property = (input) => If2(If2(Readonly2(input), ([_0, input2]) => If2(PropertyKey(input2), ([_1, input3]) => If2(Optional3(input3), ([_2, input4]) => If2(Const(":", input4), ([_3, input5]) => If2(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [PropertyMapping(_0), input2]);
  var PropertyDelimiter = (input) => If2(If2(If2(Const(",", input), ([_0, input2]) => If2(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2(If2(Const(";", input), ([_0, input2]) => If2(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2(If2(Const(",", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2(If2(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2(If2(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))))), ([_0, input2]) => [PropertyDelimiterMapping(_0), input2]);
  var PropertyList_0 = (input, result = []) => If2(If2(PropertyDelimiter(input), ([_0, input2]) => If2(Property(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => PropertyList_0(input2, [...result, _0]), () => [result, input]);
  var PropertyList = (input) => If2(If2(If2(Property(input), ([_0, input2]) => If2(PropertyList_0(input2), ([_1, input3]) => If2(If2(PropertyDelimiter(input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PropertyListMapping(_0), input2]);
  var Properties = (input) => If2(If2(Const("{", input), ([_0, input2]) => If2(PropertyList(input2), ([_1, input3]) => If2(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PropertiesMapping(_0), input2]);
  var _Object_2 = (input) => If2(Properties(input), ([_0, input2]) => [_Object_Mapping(_0), input2]);
  var ElementNamed = (input) => If2(If2(If2(Ident(input), ([_0, input2]) => If2(Const("?", input2), ([_1, input3]) => If2(Const(":", input3), ([_2, input4]) => If2(Const("readonly", input4), ([_3, input5]) => If2(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_0, input2], () => If2(If2(Ident(input), ([_0, input2]) => If2(Const(":", input2), ([_1, input3]) => If2(Const("readonly", input3), ([_2, input4]) => If2(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If2(If2(Ident(input), ([_0, input2]) => If2(Const("?", input2), ([_1, input3]) => If2(Const(":", input3), ([_2, input4]) => If2(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [_0, input2], () => If2(If2(Ident(input), ([_0, input2]) => If2(Const(":", input2), ([_1, input3]) => If2(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ElementNamedMapping(_0), input2]);
  var ElementBase = (input) => If2(If2(ElementNamed(input), ([_0, input2]) => [_0, input2], () => If2(If2(Readonly2(input), ([_0, input2]) => If2(Type(input2), ([_1, input3]) => If2(Optional3(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementBaseMapping(_0), input2]);
  var Element = (input) => If2(If2(If2(Const("...", input), ([_0, input2]) => If2(ElementBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2(If2(ElementBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementMapping(_0), input2]);
  var ElementList_0 = (input, result = []) => If2(If2(Const(",", input), ([_0, input2]) => If2(Element(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ElementList_0(input2, [...result, _0]), () => [result, input]);
  var ElementList = (input) => If2(If2(If2(Element(input), ([_0, input2]) => If2(ElementList_0(input2), ([_1, input3]) => If2(If2(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ElementListMapping(_0), input2]);
  var _Tuple_ = (input) => If2(If2(Const("[", input), ([_0, input2]) => If2(ElementList(input2), ([_1, input3]) => If2(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_Tuple_Mapping(_0), input2]);
  var ParameterReadonlyOptional = (input) => If2(If2(Ident(input), ([_0, input2]) => If2(Const("?", input2), ([_1, input3]) => If2(Const(":", input3), ([_2, input4]) => If2(Const("readonly", input4), ([_3, input5]) => If2(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [ParameterReadonlyOptionalMapping(_0), input2]);
  var ParameterReadonly = (input) => If2(If2(Ident(input), ([_0, input2]) => If2(Const(":", input2), ([_1, input3]) => If2(Const("readonly", input3), ([_2, input4]) => If2(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterReadonlyMapping(_0), input2]);
  var ParameterOptional = (input) => If2(If2(Ident(input), ([_0, input2]) => If2(Const("?", input2), ([_1, input3]) => If2(Const(":", input3), ([_2, input4]) => If2(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [ParameterOptionalMapping(_0), input2]);
  var ParameterType = (input) => If2(If2(Ident(input), ([_0, input2]) => If2(Const(":", input2), ([_1, input3]) => If2(Type(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ParameterTypeMapping(_0), input2]);
  var ParameterBase = (input) => If2(If2(ParameterReadonlyOptional(input), ([_0, input2]) => [_0, input2], () => If2(ParameterReadonly(input), ([_0, input2]) => [_0, input2], () => If2(ParameterOptional(input), ([_0, input2]) => [_0, input2], () => If2(ParameterType(input), ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [ParameterBaseMapping(_0), input2]);
  var Parameter2 = (input) => If2(If2(If2(Const("...", input), ([_0, input2]) => If2(ParameterBase(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2(If2(ParameterBase(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterMapping(_0), input2]);
  var ParameterList_0 = (input, result = []) => If2(If2(Const(",", input), ([_0, input2]) => If2(Parameter2(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ParameterList_0(input2, [...result, _0]), () => [result, input]);
  var ParameterList = (input) => If2(If2(If2(Parameter2(input), ([_0, input2]) => If2(ParameterList_0(input2), ([_1, input3]) => If2(If2(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ParameterListMapping(_0), input2]);
  var _Function_2 = (input) => If2(If2(Const("(", input), ([_0, input2]) => If2(ParameterList(input2), ([_1, input3]) => If2(Const(")", input3), ([_2, input4]) => If2(Const("=>", input4), ([_3, input5]) => If2(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [_Function_Mapping(_0), input2]);
  var _Constructor_ = (input) => If2(If2(Const("new", input), ([_0, input2]) => If2(Const("(", input2), ([_1, input3]) => If2(ParameterList(input3), ([_2, input4]) => If2(Const(")", input4), ([_3, input5]) => If2(Const("=>", input5), ([_4, input6]) => If2(Type(input6), ([_5, input7]) => [[_0, _1, _2, _3, _4, _5], input7])))))), ([_0, input2]) => [_Constructor_Mapping(_0), input2]);
  var MappedReadonly = (input) => If2(If2(If2(Const("+", input), ([_0, input2]) => If2(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2(If2(Const("-", input), ([_0, input2]) => If2(Const("readonly", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2(If2(Const("readonly", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedReadonlyMapping(_0), input2]);
  var MappedOptional = (input) => If2(If2(If2(Const("+", input), ([_0, input2]) => If2(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2(If2(Const("-", input), ([_0, input2]) => If2(Const("?", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2(If2(Const("?", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])))), ([_0, input2]) => [MappedOptionalMapping(_0), input2]);
  var MappedAs = (input) => If2(If2(If2(Const("as", input), ([_0, input2]) => If2(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [MappedAsMapping(_0), input2]);
  var _Mapped_ = (input) => If2(If2(Const("{", input), ([_0, input2]) => If2(MappedReadonly(input2), ([_1, input3]) => If2(Const("[", input3), ([_2, input4]) => If2(Ident(input4), ([_3, input5]) => If2(Const("in", input5), ([_4, input6]) => If2(Type(input6), ([_5, input7]) => If2(MappedAs(input7), ([_6, input8]) => If2(Const("]", input8), ([_7, input9]) => If2(MappedOptional(input9), ([_8, input10]) => If2(Const(":", input10), ([_9, input11]) => If2(Type(input11), ([_10, input12]) => If2(OptionalSemiColon(input12), ([_11, input13]) => If2(Const("}", input13), ([_12, input14]) => [[_0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12], input14]))))))))))))), ([_0, input2]) => [_Mapped_Mapping(_0), input2]);
  var Reference = (input) => If2(Ident(input), ([_0, input2]) => [ReferenceMapping(_0), input2]);
  var WithBigInt = (input) => If2(BigInt3(input), ([_0, input2]) => [WithBigIntMapping(_0), input2]);
  var WithNumber = (input) => If2(Number3(input), ([_0, input2]) => [WithNumberMapping(_0), input2]);
  var WithBoolean = (input) => If2(If2(Const("true", input), ([_0, input2]) => [_0, input2], () => If2(Const("false", input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithBooleanMapping(_0), input2]);
  var WithString = (input) => If2(String3(['"', "'"], input), ([_0, input2]) => [WithStringMapping(_0), input2]);
  var WithNull = (input) => If2(Const("null", input), ([_0, input2]) => [WithNullMapping(_0), input2]);
  var WithUndefined = (input) => If2(Const("undefined", input), ([_0, input2]) => [WithUndefinedMapping(_0), input2]);
  var WithProperty = (input) => If2(If2(PropertyKey(input), ([_0, input2]) => If2(Const(":", input2), ([_1, input3]) => If2(WithValue(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithPropertyMapping(_0), input2]);
  var WithPropertyList_0 = (input, result = []) => If2(If2(PropertyDelimiter(input), ([_0, input2]) => If2(WithProperty(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithPropertyList_0(input2, [...result, _0]), () => [result, input]);
  var WithPropertyList = (input) => If2(If2(If2(WithProperty(input), ([_0, input2]) => If2(WithPropertyList_0(input2), ([_1, input3]) => If2(If2(PropertyDelimiter(input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithPropertyListMapping(_0), input2]);
  var WithObject = (input) => If2(If2(Const("{", input), ([_0, input2]) => If2(WithPropertyList(input2), ([_1, input3]) => If2(Const("}", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithObjectMapping(_0), input2]);
  var WithElementList_0 = (input, result = []) => If2(If2(Const(",", input), ([_0, input2]) => If2(WithValue(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => WithElementList_0(input2, [...result, _0]), () => [result, input]);
  var WithElementList = (input) => If2(If2(If2(WithValue(input), ([_0, input2]) => If2(WithElementList_0(input2), ([_1, input3]) => If2(If2(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [WithElementListMapping(_0), input2]);
  var WithArray = (input) => If2(If2(Const("[", input), ([_0, input2]) => If2(WithElementList(input2), ([_1, input3]) => If2(Const("]", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [WithArrayMapping(_0), input2]);
  var WithValue = (input) => If2(If2(WithBigInt(input), ([_0, input2]) => [_0, input2], () => If2(WithNumber(input), ([_0, input2]) => [_0, input2], () => If2(WithBoolean(input), ([_0, input2]) => [_0, input2], () => If2(WithString(input), ([_0, input2]) => [_0, input2], () => If2(WithNull(input), ([_0, input2]) => [_0, input2], () => If2(WithUndefined(input), ([_0, input2]) => [_0, input2], () => If2(WithObject(input), ([_0, input2]) => [_0, input2], () => If2(WithArray(input), ([_0, input2]) => [_0, input2], () => [])))))))), ([_0, input2]) => [WithValueMapping(_0), input2]);
  var PatternBigInt = (input) => If2(Const("-?(?:0|[1-9][0-9]*)n", input), ([_0, input2]) => [PatternBigIntMapping(_0), input2]);
  var PatternString = (input) => If2(Const(".*", input), ([_0, input2]) => [PatternStringMapping(_0), input2]);
  var PatternNumber = (input) => If2(Const("-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", input), ([_0, input2]) => [PatternNumberMapping(_0), input2]);
  var PatternInteger = (input) => If2(Const("-?(?:0|[1-9][0-9]*)", input), ([_0, input2]) => [PatternIntegerMapping(_0), input2]);
  var PatternNever = (input) => If2(Const("(?!)", input), ([_0, input2]) => [PatternNeverMapping(_0), input2]);
  var PatternText = (input) => If2(Until_1(["-?(?:0|[1-9][0-9]*)n", ".*", "-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?", "-?(?:0|[1-9][0-9]*)", "(?!)", "(", ")", "$", "|"], input), ([_0, input2]) => [PatternTextMapping(_0), input2]);
  var PatternBase = (input) => If2(If2(PatternBigInt(input), ([_0, input2]) => [_0, input2], () => If2(PatternString(input), ([_0, input2]) => [_0, input2], () => If2(PatternNumber(input), ([_0, input2]) => [_0, input2], () => If2(PatternInteger(input), ([_0, input2]) => [_0, input2], () => If2(PatternNever(input), ([_0, input2]) => [_0, input2], () => If2(PatternGroup(input), ([_0, input2]) => [_0, input2], () => If2(PatternText(input), ([_0, input2]) => [_0, input2], () => []))))))), ([_0, input2]) => [PatternBaseMapping(_0), input2]);
  var PatternGroup = (input) => If2(If2(Const("(", input), ([_0, input2]) => If2(PatternBody(input2), ([_1, input3]) => If2(Const(")", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternGroupMapping(_0), input2]);
  var PatternUnion = (input) => If2(If2(If2(PatternTerm(input), ([_0, input2]) => If2(Const("|", input2), ([_1, input3]) => If2(PatternUnion(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2(If2(PatternTerm(input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [PatternUnionMapping(_0), input2]);
  var PatternTerm = (input) => If2(If2(PatternBase(input), ([_0, input2]) => If2(PatternBody(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [PatternTermMapping(_0), input2]);
  var PatternBody = (input) => If2(If2(PatternUnion(input), ([_0, input2]) => [_0, input2], () => If2(PatternTerm(input), ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [PatternBodyMapping(_0), input2]);
  var Pattern = (input) => If2(If2(Const("^", input), ([_0, input2]) => If2(PatternBody(input2), ([_1, input3]) => If2(Const("$", input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [PatternMapping(_0), input2]);
  var InterfaceDeclarationHeritageList_0 = (input, result = []) => If2(If2(Const(",", input), ([_0, input2]) => If2(Type(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => InterfaceDeclarationHeritageList_0(input2, [...result, _0]), () => [result, input]);
  var InterfaceDeclarationHeritageList = (input) => If2(If2(If2(Type(input), ([_0, input2]) => If2(InterfaceDeclarationHeritageList_0(input2), ([_1, input3]) => If2(If2(Const(",", input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageListMapping(_0), input2]);
  var InterfaceDeclarationHeritage = (input) => If2(If2(If2(Const("extends", input), ([_0, input2]) => If2(InterfaceDeclarationHeritageList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [InterfaceDeclarationHeritageMapping(_0), input2]);
  var InterfaceDeclarationGeneric = (input) => If2(If2(Const("interface", input), ([_0, input2]) => If2(Ident(input2), ([_1, input3]) => If2(GenericParameters(input3), ([_2, input4]) => If2(InterfaceDeclarationHeritage(input4), ([_3, input5]) => If2(Properties(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [InterfaceDeclarationGenericMapping(_0), input2]);
  var InterfaceDeclaration = (input) => If2(If2(Const("interface", input), ([_0, input2]) => If2(Ident(input2), ([_1, input3]) => If2(InterfaceDeclarationHeritage(input3), ([_2, input4]) => If2(Properties(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [InterfaceDeclarationMapping(_0), input2]);
  var TypeAliasDeclarationGeneric = (input) => If2(If2(Const("type", input), ([_0, input2]) => If2(Ident(input2), ([_1, input3]) => If2(GenericParameters(input3), ([_2, input4]) => If2(Const("=", input4), ([_3, input5]) => If2(Type(input5), ([_4, input6]) => [[_0, _1, _2, _3, _4], input6]))))), ([_0, input2]) => [TypeAliasDeclarationGenericMapping(_0), input2]);
  var TypeAliasDeclaration = (input) => If2(If2(Const("type", input), ([_0, input2]) => If2(Ident(input2), ([_1, input3]) => If2(Const("=", input3), ([_2, input4]) => If2(Type(input4), ([_3, input5]) => [[_0, _1, _2, _3], input5])))), ([_0, input2]) => [TypeAliasDeclarationMapping(_0), input2]);
  var ExportKeyword = (input) => If2(If2(If2(Const("export", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ExportKeywordMapping(_0), input2]);
  var ModuleDeclarationDelimiter = (input) => If2(If2(If2(Const(";", input), ([_0, input2]) => If2(Const("\n", input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [_0, input2], () => If2(If2(Const(";", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => If2(If2(Const("\n", input), ([_0, input2]) => [[_0], input2]), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ModuleDeclarationDelimiterMapping(_0), input2]);
  var ModuleDeclarationList_0 = (input, result = []) => If2(If2(ModuleDeclarationDelimiter(input), ([_0, input2]) => If2(ModuleDeclaration(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => ModuleDeclarationList_0(input2, [...result, _0]), () => [result, input]);
  var ModuleDeclarationList = (input) => If2(If2(If2(ModuleDeclaration(input), ([_0, input2]) => If2(ModuleDeclarationList_0(input2), ([_1, input3]) => If2(If2(ModuleDeclarationDelimiter(input3), ([_02, input4]) => [[_02], input4], () => [[], input3]), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [_0, input2], () => If2([[], input], ([_0, input2]) => [_0, input2], () => [])), ([_0, input2]) => [ModuleDeclarationListMapping(_0), input2]);
  var ModuleDeclaration = (input) => If2(If2(ExportKeyword(input), ([_0, input2]) => If2(If2(InterfaceDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If2(InterfaceDeclaration(input2), ([_02, input3]) => [_02, input3], () => If2(TypeAliasDeclarationGeneric(input2), ([_02, input3]) => [_02, input3], () => If2(TypeAliasDeclaration(input2), ([_02, input3]) => [_02, input3], () => [])))), ([_1, input3]) => If2(OptionalSemiColon(input3), ([_2, input4]) => [[_0, _1, _2], input4]))), ([_0, input2]) => [ModuleDeclarationMapping(_0), input2]);
  var Module = (input) => If2(If2(ModuleDeclaration(input), ([_0, input2]) => If2(ModuleDeclarationList(input2), ([_1, input3]) => [[_0, _1], input3])), ([_0, input2]) => [ModuleMapping(_0), input2]);
  var Script = (input) => If2(If2(Module(input), ([_0, input2]) => [_0, input2], () => If2(GenericType(input), ([_0, input2]) => [_0, input2], () => If2(Type(input), ([_0, input2]) => [_0, input2], () => []))), ([_0, input2]) => [ScriptMapping(_0), input2]);


  function ParseTemplateIntoTypes(template) {
    const parsed = TemplateLiteralTypes(`\`${template}\``);
    const result = guard_exports.IsEqual(parsed.length, 2) ? parsed[0] : Unreachable();
    return result;
  }


  function JoinString(input) {
    return input.join("|");
  }
  function UnwrapTemplateLiteralPattern(pattern) {
    return pattern.slice(1, pattern.length - 1);
  }
  function EncodeLiteral(value, right, pattern) {
    return EncodeTypes(right, `${pattern}${value}`);
  }
  function EncodeBigInt(right, pattern) {
    return EncodeTypes(right, `${pattern}${BigIntPattern}`);
  }
  function EncodeInteger(right, pattern) {
    return EncodeTypes(right, `${pattern}${IntegerPattern}`);
  }
  function EncodeNumber(right, pattern) {
    return EncodeTypes(right, `${pattern}${NumberPattern}`);
  }
  function EncodeBoolean(right, pattern) {
    return EncodeType(Union([Literal("false"), Literal("true")]), right, pattern);
  }
  function EncodeString(right, pattern) {
    return EncodeTypes(right, `${pattern}${StringPattern}`);
  }
  function EncodeTemplateLiteral(templatePattern, right, pattern) {
    return EncodeTypes(right, `${pattern}${UnwrapTemplateLiteralPattern(templatePattern)}`);
  }
  function EncodeTemplateLiteralDeferred(types2, right, pattern) {
    const templateLiteral = TemplateLiteralAction(types2, {});
    const result = EncodeType(templateLiteral, right, pattern);
    return result;
  }
  function EncodeEnum(values, right, pattern) {
    const evaluated = EvaluateEnum(values);
    return EncodeType(evaluated, right, pattern);
  }
  function EncodeUnion(types2, right, pattern, result = []) {
    return guard_exports.ShiftLeft(types2, (head, tail) => EncodeUnion(tail, right, pattern, [...result, EncodeType(head, [], "")]), () => EncodeTypes(right, `${pattern}(${JoinString(result)})`));
  }
  function EncodeType(type2, right, pattern) {
    return IsEnum(type2) ? EncodeEnum(type2.enum, right, pattern) : IsInteger3(type2) ? EncodeInteger(right, pattern) : IsLiteral(type2) ? EncodeLiteral(type2.const, right, pattern) : IsBigInt3(type2) ? EncodeBigInt(right, pattern) : IsBoolean4(type2) ? EncodeBoolean(right, pattern) : IsNumber4(type2) ? EncodeNumber(right, pattern) : IsString4(type2) ? EncodeString(right, pattern) : IsTemplateLiteral(type2) ? EncodeTemplateLiteral(type2.pattern, right, pattern) : IsTemplateLiteralDeferred(type2) ? EncodeTemplateLiteralDeferred(type2.parameters[0], right, pattern) : IsUnion(type2) ? EncodeUnion(type2.anyOf, right, pattern) : NeverPattern;
  }
  function EncodeTypes(types2, pattern) {
    return guard_exports.ShiftLeft(types2, (left, right) => EncodeType(left, right, pattern), () => pattern);
  }
  function EncodePattern(types2) {
    const encoded = EncodeTypes(types2, "");
    const result = `^${encoded}$`;
    return result;
  }
  function TemplateLiteralEncode(types2) {
    const pattern = EncodePattern(types2);
    const result = TemplateLiteralCreate(pattern);
    return result;
  }


  function TemplateLiteralAction(types2, options) {
    const result = CanInstantiate(types2) ? memory_exports.Update(TemplateLiteralEncode(types2), {}, options) : TemplateLiteralDeferred(types2, options);
    return result;
  }
  function TemplateLiteralInstantiate(context, state2, types2, options) {
    const instantiatedTypes = InstantiateTypes(context, state2, types2);
    return TemplateLiteralAction(instantiatedTypes, options);
  }


  function TemplateLiteralDeferred(types2, options = {}) {
    return Deferred("TemplateLiteral", [types2], options);
  }
  function IsTemplateLiteralDeferred(value) {
    return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "TemplateLiteral");
  }
  function TemplateLiteralFromTypes(types2) {
    return TemplateLiteralAction(types2, {});
  }
  function TemplateLiteralFromString(template) {
    const types2 = ParseTemplateIntoTypes(template);
    return TemplateLiteralFromTypes(types2);
  }
  function TemplateLiteral2(input, options = {}) {
    const type2 = guard_exports.IsString(input) ? TemplateLiteralFromString(input) : TemplateLiteralFromTypes(input);
    return memory_exports.Update(type2, {}, options);
  }
  function IsTemplateLiteral(value) {
    return IsKind(value, "TemplateLiteral");
  }


  var result_exports = {};
  __export(result_exports, {
    ExtendsFalse: () => ExtendsFalse,
    ExtendsTrue: () => ExtendsTrue,
    ExtendsUnion: () => ExtendsUnion,
    IsExtendsFalse: () => IsExtendsFalse,
    IsExtendsTrue: () => IsExtendsTrue,
    IsExtendsTrueLike: () => IsExtendsTrueLike,
    IsExtendsUnion: () => IsExtendsUnion,
    Match: () => Match3
  });
  function ExtendsUnion(inferred) {
    return memory_exports.Create({ ["~kind"]: "ExtendsUnion" }, { inferred });
  }
  function IsExtendsUnion(value) {
    return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsUnion") && guard_exports.IsObject(value.inferred);
  }
  function ExtendsTrue(inferred) {
    return memory_exports.Create({ ["~kind"]: "ExtendsTrue" }, { inferred });
  }
  function IsExtendsTrue(value) {
    return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "inferred") && guard_exports.IsEqual(value["~kind"], "ExtendsTrue") && guard_exports.IsObject(value.inferred);
  }
  function ExtendsFalse() {
    return memory_exports.Create({ ["~kind"]: "ExtendsFalse" }, {});
  }
  function IsExtendsFalse(value) {
    return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.IsEqual(value["~kind"], "ExtendsFalse");
  }
  function IsExtendsTrueLike(value) {
    return IsExtendsUnion(value) || IsExtendsTrue(value);
  }
  function Match3(result, true_, false_) {
    return IsExtendsTrueLike(result) ? true_(result.inferred) : false_();
  }


  function ExtendsRightInfer(inferred, name, left, right) {
    return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => ExtendsTrue(memory_exports.Assign(memory_exports.Assign(inferred, checkInferred), { [name]: left })), () => ExtendsFalse());
  }
  function ExtendsRightAny(inferred, _left) {
    return ExtendsTrue(inferred);
  }
  function ExtendsRightDependent(inferred, left, if_, then_, else_) {
    return Match3(ExtendsLeft(inferred, left, if_), (inferred2) => Match3(ExtendsLeft(inferred2, left, then_), (inferred3) => ExtendsTrue(inferred3), () => ExtendsFalse()), () => Match3(ExtendsLeft(inferred, left, else_), (inferred2) => ExtendsTrue(inferred2), () => ExtendsFalse()));
  }
  function ExtendsRightEnum(inferred, left, right) {
    const evaluated = EvaluateEnum(right);
    return ExtendsLeft(inferred, left, evaluated);
  }
  function ExtendsRightIntersect(inferred, left, right) {
    return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsRightIntersect(inferred2, left, tail), () => ExtendsFalse()), () => ExtendsTrue(inferred));
  }
  function ExtendsRightTemplateLiteral(inferred, left, right) {
    const evaluated = EvaluateTemplateLiteral(right);
    return ExtendsLeft(inferred, left, evaluated);
  }
  function ExtendsRightUnion(inferred, left, right) {
    return guard_exports.ShiftLeft(right, (head, tail) => Match3(ExtendsLeft(inferred, left, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsRightUnion(inferred, left, tail)), () => ExtendsFalse());
  }
  function ExtendsRight(inferred, left, right) {
    return IsAny(right) ? ExtendsRightAny(inferred, left) : IsDependent(right) ? ExtendsRightDependent(inferred, left, right.if, right.then, right.else) : IsEnum(right) ? ExtendsRightEnum(inferred, left, right.enum) : IsInfer(right) ? ExtendsRightInfer(inferred, right.name, left, right.extends) : IsIntersect(right) ? ExtendsRightIntersect(inferred, left, right.allOf) : IsTemplateLiteral(right) ? ExtendsRightTemplateLiteral(inferred, left, right.pattern) : IsUnion(right) ? ExtendsRightUnion(inferred, left, right.anyOf) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
  }


  function ExtendsAny(inferred, left, right) {
    return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsUnion(inferred);
  }


  function ExtendsImmutable(left, right) {
    const isImmutableLeft = IsImmutable(left);
    const isImmutableRight = IsImmutable(right);
    return isImmutableLeft && isImmutableRight ? true : !isImmutableLeft && isImmutableRight ? true : isImmutableLeft && !isImmutableRight ? false : true;
  }
  function ExtendsArray(inferred, arrayLeft, left, right) {
    return IsArray3(right) ? ExtendsImmutable(arrayLeft, right) ? ExtendsLeft(inferred, left, right.items) : ExtendsFalse() : ExtendsRight(inferred, arrayLeft, right);
  }


  function ExtendsBigInt(inferred, left, right) {
    return IsBigInt3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
  }


  function ExtendsBoolean(inferred, left, right) {
    return IsBoolean4(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
  }


  function ParameterCompare(inferred, left, leftRest, right, rightRest) {
    const checkLeft = IsInfer(right) ? left : right;
    const checkRight = IsInfer(right) ? right : left;
    const isLeftOptional = IsOptional(left);
    const isRightOptional = IsOptional(right);
    return !isLeftOptional && isRightOptional ? ExtendsFalse() : Match3(ExtendsLeft(inferred, checkLeft, checkRight), (inferred2) => ExtendsParameters(inferred2, leftRest, rightRest), () => ExtendsFalse());
  }
  function ParameterRight(inferred, left, leftRest, rightRest) {
    return guard_exports.ShiftLeft(rightRest, (head, tail) => ParameterCompare(inferred, left, leftRest, head, tail), () => IsOptional(left) ? ExtendsTrue(inferred) : ExtendsFalse());
  }
  function ParametersLeft(inferred, left, rightRest) {
    return guard_exports.ShiftLeft(left, (head, tail) => ParameterRight(inferred, head, tail, rightRest), () => ExtendsTrue(inferred));
  }
  function ExtendsParameters(inferred, left, right) {
    return ParametersLeft(inferred, left, right);
  }


  function ExtendsReturnType(inferred, left, right) {
    return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsLeft(inferred, left, right);
  }


  function ExtendsConstructor(inferred, parameters, returnType, right) {
    return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsConstructor3(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["instanceType"]), () => ExtendsFalse()) : ExtendsFalse();
  }


  function ExtendsDependent(inferred, if_, then_, else_, right) {
    return Match3(ExtendsLeft(inferred, if_, right), () => ExtendsLeft(inferred, then_, right), () => ExtendsLeft(inferred, else_, right));
  }


  function ExtendsEnum(inferred, left, right) {
    const evaluated = EvaluateEnum(left);
    return ExtendsLeft(inferred, evaluated, right);
  }


  function ExtendsFunction(inferred, parameters, returnType, right) {
    return IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : IsFunction3(right) ? Match3(ExtendsParameters(inferred, parameters, right["parameters"]), (inferred2) => ExtendsReturnType(inferred2, returnType, right["returnType"]), () => ExtendsFalse()) : ExtendsFalse();
  }


  function ExtendsInteger(inferred, left, right) {
    return IsInteger3(right) ? ExtendsTrue(inferred) : IsNumber4(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
  }


  function ExtendsIntersect(inferred, left, right) {
    const evaluated = EvaluateIntersect(left);
    return ExtendsLeft(inferred, evaluated, right);
  }


  function ExtendsLiteralValue(inferred, left, right) {
    return left === right ? ExtendsTrue(inferred) : ExtendsFalse();
  }
  function ExtendsLiteralBigInt(inferred, left, right) {
    return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBigInt3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
  }
  function ExtendsLiteralBoolean(inferred, left, right) {
    return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsBoolean4(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
  }
  function ExtendsLiteralNumber(inferred, left, right) {
    return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsNumber4(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
  }
  function ExtendsLiteralString(inferred, left, right) {
    return IsLiteral(right) ? ExtendsLiteralValue(inferred, left, right.const) : IsString4(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, Literal(left), right);
  }
  function ExtendsLiteral(inferred, left, right) {
    return guard_exports.IsBigInt(left.const) ? ExtendsLiteralBigInt(inferred, left.const, right) : guard_exports.IsBoolean(left.const) ? ExtendsLiteralBoolean(inferred, left.const, right) : guard_exports.IsNumber(left.const) ? ExtendsLiteralNumber(inferred, left.const, right) : guard_exports.IsString(left.const) ? ExtendsLiteralString(inferred, left.const, right) : Unreachable();
  }


  function ExtendsNever(inferred, left, right) {
    return IsInfer(right) ? ExtendsRight(inferred, left, right) : ExtendsTrue(inferred);
  }


  function ExtendsNull(inferred, left, right) {
    return IsNull3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
  }


  function ExtendsNumber(inferred, left, right) {
    return IsNumber4(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
  }


  function ExtendsPropertyOptional(inferred, left, right) {
    return IsOptional(left) ? IsOptional(right) ? ExtendsTrue(inferred) : ExtendsFalse() : ExtendsTrue(inferred);
  }
  function ExtendsProperty(inferred, left, right) {
    return (
      // Right TInfer<TNever> is TExtendsFalse
      IsInfer(right) && IsNever(right.extends) ? ExtendsFalse() : Match3(ExtendsLeft(inferred, left, right), (inferred2) => ExtendsPropertyOptional(inferred2, left, right), () => ExtendsFalse())
    );
  }
  function ExtractInferredProperties(keys, properties) {
    return keys.reduce((result, key) => {
      return key in properties ? IsExtendsTrueLike(properties[key]) ? { ...result, ...properties[key].inferred } : Unreachable() : Unreachable();
    }, {});
  }
  function ExtendsPropertiesComparer(inferred, left, right) {
    const properties = {};
    for (const rightKey of guard_exports.Keys(right)) {
      properties[rightKey] = rightKey in left ? ExtendsProperty({}, left[rightKey], right[rightKey]) : IsOptional(right[rightKey]) ? IsInfer(right[rightKey]) ? ExtendsTrue(memory_exports.Assign(inferred, { [right[rightKey].name]: right[rightKey].extends })) : ExtendsTrue(inferred) : ExtendsFalse();
    }
    const checked = guard_exports.Values(properties).every((result) => IsExtendsTrueLike(result));
    const extracted = checked ? ExtractInferredProperties(guard_exports.Keys(properties), properties) : {};
    return checked ? ExtendsTrue(extracted) : ExtendsFalse();
  }
  function ExtendsProperties(inferred, left, right) {
    const compared = ExtendsPropertiesComparer(inferred, left, right);
    return IsExtendsTrueLike(compared) ? ExtendsTrue(memory_exports.Assign(inferred, compared.inferred)) : ExtendsFalse();
  }
  function ExtendsObjectToObject(inferred, left, right) {
    return ExtendsProperties(inferred, left, right);
  }
  function RecordMergeInferred(left, right) {
    return guard_exports.Keys(right).reduce((result, key) => {
      return {
        ...result,
        [key]: guard_exports.HasPropertyKey(left, key) ? IsUnion(result[key]) ? Union([...result[key].anyOf, right[key]]) : Union([left[key], right[key]]) : right[key]
      };
    }, left);
  }
  function ExtendsRecordComparer(properties, keys, type2, result) {
    return guard_exports.ShiftLeft(keys, (left, right) => Match3(ExtendsLeft({}, properties[left], type2), (inferred) => ExtendsRecordComparer(properties, right, type2, RecordMergeInferred(result, inferred)), () => ExtendsFalse()), () => ExtendsTrue(result));
  }
  function ExtendsObjectToRecord(inferred, properties, _pattern, value) {
    const keys = guard_exports.Keys(properties);
    const result = ExtendsRecordComparer(properties, keys, value, inferred);
    return result;
  }
  function ExtendsObject(inferred, left, right) {
    return IsRecord(right) ? ExtendsObjectToRecord(inferred, left, RecordPattern(right), RecordValue(right)) : IsObject3(right) ? ExtendsObjectToObject(inferred, left, right.properties) : ExtendsRight(inferred, _Object_(left), right);
  }


  function FromObject3(inferred, properties) {
    return guard_exports.IsEqual(guard_exports.Keys(properties).length, 0) ? ExtendsTrue(inferred) : ExtendsFalse();
  }
  function FromRecord(inferred, _leftKey, leftValue, _rightKey, rightValue) {
    return ExtendsLeft(inferred, leftValue, rightValue);
  }
  function ExtendsRecord(inferred, leftPattern, leftValue, right) {
    return IsRecord(right) ? FromRecord(inferred, RecordPatternToType(leftPattern), leftValue, RecordPatternToType(RecordPattern(right)), RecordValue(right)) : IsObject3(right) ? FromObject3(inferred, right.properties) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
  }


  function ExtendsString(inferred, left, right) {
    return IsString4(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
  }


  function ExtendsSymbol(inferred, left, right) {
    return IsSymbol3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
  }


  function ExtendsTemplateLiteral(inferred, left, right) {
    const evaluated = EvaluateTemplateLiteral(left);
    return ExtendsLeft(inferred, evaluated, right);
  }


  function Inferrable(name, type2) {
    return memory_exports.Create({ "~kind": "Inferrable" }, { name, type: type2 }, {});
  }
  function IsInferable(value) {
    return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "~kind") && guard_exports.HasPropertyKey(value, "name") && guard_exports.HasPropertyKey(value, "type") && guard_exports.IsEqual(value["~kind"], "Inferrable") && guard_exports.IsString(value.name) && guard_exports.IsObject(value.type);
  }
  function TryRestInferable(type2) {
    return IsRest(type2) ? IsInfer(type2.items) ? IsArray3(type2.items.extends) ? Inferrable(type2.items.name, type2.items.extends.items) : IsUnknown(type2.items.extends) ? Inferrable(type2.items.name, type2.items.extends) : void 0 : Unreachable() : void 0;
  }
  function TryInferable(type2) {
    return IsInfer(type2) ? Inferrable(type2.name, type2.extends) : void 0;
  }
  function TryInferResults(rest, right, result = []) {
    return guard_exports.ShiftLeft(rest, (head, tail) => Match3(ExtendsLeft({}, head, right), () => TryInferResults(tail, right, [...result, head]), () => void 0), () => result);
  }
  function InferTupleResult(inferred, name, left, right) {
    const results = TryInferResults(left, right);
    return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Tuple(results) })) : ExtendsFalse();
  }
  function InferUnionResult(inferred, name, left, right) {
    const results = TryInferResults(left, right);
    return guard_exports.IsArray(results) ? ExtendsTrue(memory_exports.Assign(inferred, { [name]: Union(results) })) : ExtendsFalse();
  }


  function Reverse(types2) {
    return [...types2].reverse();
  }
  function ApplyReverse(types2, reversed) {
    return reversed ? Reverse(types2) : types2;
  }
  function Reversed(types2) {
    const first = types2.length > 0 ? types2[0] : void 0;
    const inferrable = IsSchema(first) ? TryRestInferable(first) : void 0;
    return IsSchema(inferrable);
  }
  function ElementsCompare(inferred, reversed, left, leftRest, right, rightRest) {
    return Match3(ExtendsLeft(inferred, left, right), (checkInferred) => Elements(checkInferred, reversed, leftRest, rightRest), () => ExtendsFalse());
  }
  function ElementsLeft(inferred, reversed, leftRest, right, rightRest) {
    const inferable = TryRestInferable(right);
    return (
      // Rest Inferrable Right Means we delegate to TInferTupleResult to Generate a Result
      IsInferable(inferable) ? InferTupleResult(inferred, inferable["name"], ApplyReverse(leftRest, reversed), inferable["type"]) : guard_exports.ShiftLeft(leftRest, (head, tail) => ElementsCompare(inferred, reversed, head, tail, right, rightRest), () => ExtendsFalse())
    );
  }
  function ElementsRight(inferred, reversed, leftRest, rightRest) {
    return guard_exports.ShiftLeft(rightRest, (head, tail) => ElementsLeft(inferred, reversed, leftRest, head, tail), () => guard_exports.IsEqual(leftRest.length, 0) ? ExtendsTrue(inferred) : ExtendsFalse());
  }
  function Elements(inferred, reversed, leftRest, rightRest) {
    return ElementsRight(inferred, reversed, leftRest, rightRest);
  }
  function ExtendsTupleToTuple(inferred, left, right) {
    const instantiatedRight = InstantiateElements(inferred, State([], []), right);
    const reversed = Reversed(instantiatedRight);
    return Elements(inferred, reversed, ApplyReverse(left, reversed), ApplyReverse(instantiatedRight, reversed));
  }
  function ExtendsTupleToArray(inferred, left, right) {
    const inferrable = TryInferable(right);
    return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable["name"], left, inferrable["type"]) : guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsLeft(inferred, head, right), (inferred2) => ExtendsTupleToArray(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
  }
  function ExtendsTuple(inferred, left, right) {
    const instantiatedLeft = InstantiateElements(inferred, State([], []), left);
    return IsTuple(right) ? ExtendsTupleToTuple(inferred, instantiatedLeft, right.items) : IsArray3(right) ? ExtendsTupleToArray(inferred, instantiatedLeft, right.items) : ExtendsRight(inferred, Tuple(instantiatedLeft), right);
  }


  function ExtendsUndefined(inferred, left, right) {
    return IsVoid(right) ? ExtendsTrue(inferred) : IsUndefined3(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
  }


  function ExtendsUnionSome(inferred, type2, unionTypes) {
    return guard_exports.ShiftLeft(unionTypes, (head, tail) => Match3(ExtendsLeft(inferred, type2, head), (inferred2) => ExtendsTrue(inferred2), () => ExtendsUnionSome(inferred, type2, tail)), () => ExtendsFalse());
  }
  function ExtendsUnionLeft(inferred, left, right) {
    return guard_exports.ShiftLeft(left, (head, tail) => Match3(ExtendsUnionSome(inferred, head, right), (inferred2) => ExtendsUnionLeft(inferred2, tail, right), () => ExtendsFalse()), () => ExtendsTrue(inferred));
  }
  function ExtendsUnion2(inferred, left, right) {
    const inferrable = TryInferable(right);
    return IsInferable(inferrable) ? InferUnionResult(inferred, inferrable.name, left, inferrable.type) : IsUnion(right) ? ExtendsUnionLeft(inferred, left, right.anyOf) : ExtendsUnionLeft(inferred, left, [right]);
  }


  function ExtendsUnknown(inferred, left, right) {
    return IsInfer(right) ? ExtendsRight(inferred, left, right) : IsAny(right) ? ExtendsTrue(inferred) : IsUnknown(right) ? ExtendsTrue(inferred) : ExtendsFalse();
  }


  function ExtendsVoid(inferred, left, right) {
    return IsVoid(right) ? ExtendsTrue(inferred) : ExtendsRight(inferred, left, right);
  }


  function ExtendsLeft(inferred, left, right) {
    return IsAny(left) ? ExtendsAny(inferred, left, right) : IsArray3(left) ? ExtendsArray(inferred, left, left.items, right) : IsBigInt3(left) ? ExtendsBigInt(inferred, left, right) : IsBoolean4(left) ? ExtendsBoolean(inferred, left, right) : IsConstructor3(left) ? ExtendsConstructor(inferred, left.parameters, left.instanceType, right) : IsDependent(left) ? ExtendsDependent(inferred, left.if, left.then, left.else, right) : IsEnum(left) ? ExtendsEnum(inferred, left.enum, right) : IsFunction3(left) ? ExtendsFunction(inferred, left.parameters, left.returnType, right) : IsInteger3(left) ? ExtendsInteger(inferred, left, right) : IsIntersect(left) ? ExtendsIntersect(inferred, left.allOf, right) : IsLiteral(left) ? ExtendsLiteral(inferred, left, right) : IsNever(left) ? ExtendsNever(inferred, left, right) : IsNull3(left) ? ExtendsNull(inferred, left, right) : IsNumber4(left) ? ExtendsNumber(inferred, left, right) : IsObject3(left) ? ExtendsObject(inferred, left.properties, right) : IsRecord(left) ? ExtendsRecord(inferred, RecordPattern(left), RecordValue(left), right) : IsString4(left) ? ExtendsString(inferred, left, right) : IsSymbol3(left) ? ExtendsSymbol(inferred, left, right) : IsTemplateLiteral(left) ? ExtendsTemplateLiteral(inferred, left.pattern, right) : IsTuple(left) ? ExtendsTuple(inferred, left.items, right) : IsUndefined3(left) ? ExtendsUndefined(inferred, left, right) : IsUnion(left) ? ExtendsUnion2(inferred, left.anyOf, right) : IsUnknown(left) ? ExtendsUnknown(inferred, left, right) : IsVoid(left) ? ExtendsVoid(inferred, left, right) : ExtendsFalse();
  }


  function InterfaceOperation(heritage, properties) {
    const result = EvaluateIntersect([...heritage, _Object_(properties)]);
    return result;
  }
  function InterfaceAction(heritage, properties, options) {
    const result = CanInstantiate(heritage) ? memory_exports.Update(InterfaceOperation(heritage, properties), {}, options) : InterfaceDeferred(heritage, properties, options);
    return result;
  }
  function InterfaceInstantiate(context, state2, heritage, properties, options) {
    const instantiatedHeritage = InstantiateTypes(context, state2, heritage);
    const instantiatedProperties = InstantiateProperties(context, state2, properties);
    return InterfaceAction(instantiatedHeritage, instantiatedProperties, options);
  }


  function InterfaceDeferred(heritage, properties, options = {}) {
    return Deferred("Interface", [heritage, properties], options);
  }
  function IsInterfaceDeferred(value) {
    return IsSchema(value) && guard_exports.HasPropertyKey(value, "action") && guard_exports.IsEqual(value.action, "Interface");
  }
  function Interface(heritage, properties, options = {}) {
    return InterfaceAction(heritage, properties, options);
  }


  function FromRef(stack, context, ref) {
    return stack.includes(ref) ? true : FromType3([...stack, ref], context, context[ref]);
  }
  function FromProperties(stack, context, properties) {
    const types2 = PropertyValues(properties);
    return FromTypes2(stack, context, types2);
  }
  function FromTypes2(stack, context, types2) {
    return guard_exports.ShiftLeft(types2, (left, right) => FromType3(stack, context, left) ? true : FromTypes2(stack, context, right), () => false);
  }
  function FromType3(stack, context, type2) {
    return IsRef(type2) ? FromRef(stack, context, type2.$ref) : IsArray3(type2) ? FromType3(stack, context, type2.items) : IsConstructor3(type2) ? FromTypes2(stack, context, [...type2.parameters, type2.instanceType]) : IsFunction3(type2) ? FromTypes2(stack, context, [...type2.parameters, type2.returnType]) : IsInterfaceDeferred(type2) ? FromProperties(stack, context, type2.parameters[1]) : IsIntersect(type2) ? FromTypes2(stack, context, type2.allOf) : IsObject3(type2) ? FromProperties(stack, context, type2.properties) : IsUnion(type2) ? FromTypes2(stack, context, type2.anyOf) : IsTuple(type2) ? FromTypes2(stack, context, type2.items) : IsRecord(type2) ? FromType3(stack, context, RecordValue(type2)) : false;
  }
  function CyclicCheck(stack, context, type2) {
    const result = FromType3(stack, context, type2);
    return result;
  }


  function ResolveCandidateKeys(context, keys) {
    return keys.reduce((result, left) => {
      return CyclicCheck([left], context, context[left]) ? [...result, left] : result;
    }, []);
  }
  function CyclicCandidates(context) {
    const keys = PropertyKeys(context);
    const result = ResolveCandidateKeys(context, keys);
    return result;
  }


  function FromRef2(context, ref, result) {
    return result.includes(ref) ? result : ref in context ? FromType4(context, context[ref], [...result, ref]) : Unreachable();
  }
  function FromProperties2(context, properties, result) {
    const types2 = PropertyValues(properties);
    return FromTypes3(context, types2, result);
  }
  function FromTypes3(context, types2, result) {
    return types2.reduce((result2, left) => {
      return FromType4(context, left, result2);
    }, result);
  }
  function FromType4(context, type2, result) {
    return IsRef(type2) ? FromRef2(context, type2.$ref, result) : IsArray3(type2) ? FromType4(context, type2.items, result) : IsConstructor3(type2) ? FromTypes3(context, [...type2.parameters, type2.instanceType], result) : IsFunction3(type2) ? FromTypes3(context, [...type2.parameters, type2.returnType], result) : IsInterfaceDeferred(type2) ? FromProperties2(context, type2.parameters[1], result) : IsIntersect(type2) ? FromTypes3(context, type2.allOf, result) : IsObject3(type2) ? FromProperties2(context, type2.properties, result) : IsUnion(type2) ? FromTypes3(context, type2.anyOf, result) : IsTuple(type2) ? FromTypes3(context, type2.items, result) : IsRecord(type2) ? FromType4(context, RecordValue(type2), result) : result;
  }
  function CyclicDependencies(context, key, type2) {
    const result = FromType4(context, type2, [key]);
    return result;
  }


  function FromRef3(_ref) {
    return Any();
  }
  function FromProperties3(properties) {
    return guard_exports.Keys(properties).reduce((result, key) => {
      return { ...result, [key]: FromType5(properties[key]) };
    }, {});
  }
  function FromTypes4(types2) {
    return types2.reduce((result, left) => {
      return [...result, FromType5(left)];
    }, []);
  }
  function FromType5(type2) {
    return IsRef(type2) ? FromRef3(type2.$ref) : IsArray3(type2) ? _Array_(FromType5(type2.items), ArrayOptions(type2)) : IsConstructor3(type2) ? Constructor(FromTypes4(type2.parameters), FromType5(type2.instanceType)) : IsFunction3(type2) ? _Function_(FromTypes4(type2.parameters), FromType5(type2.returnType)) : IsIntersect(type2) ? Intersect(FromTypes4(type2.allOf)) : IsObject3(type2) ? _Object_(FromProperties3(type2.properties)) : IsRecord(type2) ? Record(RecordKey(type2), FromType5(RecordValue(type2))) : IsUnion(type2) ? Union(FromTypes4(type2.anyOf)) : IsTuple(type2) ? Tuple(FromTypes4(type2.items)) : type2;
  }
  function CyclicAnyFromParameters(defs, ref) {
    return ref in defs ? FromType5(defs[ref]) : Unknown();
  }
  function CyclicExtends(type2) {
    return CyclicAnyFromParameters(type2.$defs, type2.$ref);
  }


  function CyclicInterface(context, heritage, properties) {
    const instantiatedHeritage = InstantiateTypes(context, State([], []), heritage);
    const instantiatedProperties = InstantiateProperties({}, State([], []), properties);
    const evaluatedInterface = EvaluateIntersect([...instantiatedHeritage, _Object_(instantiatedProperties)]);
    return evaluatedInterface;
  }
  function CyclicDefinitions(context, dependencies) {
    const keys = guard_exports.Keys(context).filter((key) => dependencies.includes(key));
    return keys.reduce((result, key) => {
      const type2 = context[key];
      const instantiatedType = IsInterfaceDeferred(type2) ? CyclicInterface(context, type2.parameters[0], type2.parameters[1]) : type2;
      return { ...result, [key]: instantiatedType };
    }, {});
  }
  function InstantiateCyclic(context, ref, type2) {
    const dependencies = CyclicDependencies(context, ref, type2);
    const definitions = CyclicDefinitions(context, dependencies);
    const result = Cyclic(definitions, ref);
    return result;
  }


  function Resolve(defs, ref) {
    return ref in defs ? IsRef(defs[ref]) ? Resolve(defs, defs[ref].$ref) : defs[ref] : Never();
  }
  function CyclicTarget(defs, ref) {
    const result = Resolve(defs, ref);
    return result;
  }


  function Canonical(type2) {
    return IsCyclic(type2) ? CyclicExtends(type2) : IsUnsafe(type2) ? Unknown() : type2;
  }
  function Extends(inferred, left, right) {
    const canonicalLeft = Canonical(left);
    const canonicalRight = Canonical(right);
    return ExtendsLeft(inferred, canonicalLeft, canonicalRight);
  }


  var CompareResultEqual = 0;
  var CompareResultDisjoint = 1;
  var CompareResultLeftInside = 2;
  var CompareResultRightInside = 3;
  function Compare(left, right) {
    const extendsCheck = [Extends({}, left, right), Extends({}, right, left)];
    return result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? CompareResultEqual : result_exports.IsExtendsTrueLike(extendsCheck[0]) && result_exports.IsExtendsFalse(extendsCheck[1]) ? CompareResultLeftInside : result_exports.IsExtendsFalse(extendsCheck[0]) && result_exports.IsExtendsTrueLike(extendsCheck[1]) ? CompareResultRightInside : CompareResultDisjoint;
  }


  function BroadenFilter(type2, types2, result = [], all = types2) {
    return guard_exports.ShiftLeft(types2, (left, right) => {
      const compare = Compare(type2, left);
      return guard_exports.IsEqual(compare, CompareResultLeftInside) || guard_exports.IsEqual(compare, CompareResultEqual) ? all : guard_exports.IsEqual(compare, CompareResultDisjoint) ? BroadenFilter(type2, right, [...result, left], all) : BroadenFilter(type2, right, result, all);
    }, () => [...result, type2]);
  }
  function BroadenType(type2, types2, result) {
    const evaluated = EvaluateType(type2);
    return IsAny(evaluated) ? [evaluated] : (
      // terminate (always the most broad)
      IsUnknown(evaluated) ? [evaluated] : (
        // terminate (always the most broad)
        IsNever(evaluated) ? BroadenTypes(types2, result) : (
          // ignored: never is dropped
          IsObject3(evaluated) ? BroadenTypes(types2, [...result, evaluated]) : (
            // objects are always considered (too expensive to compare)
            BroadenTypes(types2, BroadenFilter(evaluated, result))
          )
        )
      )
    );
  }
  function BroadenTypes(types2, result = []) {
    return guard_exports.ShiftLeft(types2, (left, right) => BroadenType(left, right, result), () => result);
  }
  function Broaden(types2) {
    const broadened = BroadenTypes(types2);
    const flattened = Flatten(broadened);
    return flattened;
  }


  function EvaluateAction(type2, options) {
    const result = memory_exports.Update(EvaluateType(type2), {}, options);
    return result;
  }
  function EvaluateInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return EvaluateAction(instantiatedType, options);
  }


  function CollectDistributionNames(expression, result = []) {
    return (
      // Conditional
      IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? IsRef(expression.parameters[0]) ? CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], [...result, expression.parameters[0]["$ref"]])) : CollectDistributionNames(expression.parameters[2], CollectDistributionNames(expression.parameters[3], result)) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? IsDeferred(expression.parameters[1]) && guard_exports.IsEqual(expression.parameters[1].action, "KeyOf") && IsRef(expression.parameters[1].parameters[0]) ? [...result, expression.parameters[1].parameters[0]["$ref"]] : result : result
    );
  }
  function BuildDistributionArray(parameters, names2) {
    return parameters.reduce((result, left) => [...result, names2.includes(left.name)], []);
  }
  function ZipDistributionArray(arguments_, distributionArray, result = []) {
    return guard_exports.ShiftLeft(arguments_, (argumentLeft, argumentRight) => guard_exports.ShiftLeft(distributionArray, (booleanLeft, booleanRight) => ZipDistributionArray(argumentRight, booleanRight, [...result, [booleanLeft, argumentLeft]]), () => result), () => result);
  }
  function CanonicalArgument(type2) {
    return IsTemplateLiteral(type2) ? EvaluateTemplateLiteral(type2.pattern) : IsEnum(type2) ? EvaluateEnum(type2.enum) : type2;
  }
  function Expand(type2) {
    const canonicalArgument = CanonicalArgument(type2);
    return IsUnion(canonicalArgument) ? [...canonicalArgument.anyOf] : [canonicalArgument];
  }
  function Append(current, type2) {
    return current.reduce((result, left) => [...result, [...left, type2]], []);
  }
  function Cross(current, variants) {
    return variants.reduce((result, left) => {
      return [...result, ...Append(current, left)];
    }, []);
  }
  function Distribute2(zipped) {
    return zipped.reduce((result, left) => {
      return guard_exports.IsEqual(left[0], true) ? Cross(result, Expand(left[1])) : Cross(result, [left[1]]);
    }, [[]]);
  }
  function DistributeArguments(parameters, arguments_, expression) {
    const distributionNames = CollectDistributionNames(expression);
    const distributionArray = BuildDistributionArray(parameters, distributionNames);
    const zippedArguments = ZipDistributionArray(arguments_, distributionArray);
    return IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Conditional") ? Distribute2(zippedArguments) : IsDeferred(expression) && guard_exports.IsEqual(expression.action, "Mapped") ? Distribute2(zippedArguments) : [arguments_];
  }


  function FromNotResolvable() {
    return ["(not-resolvable)", Never()];
  }
  function FromNotGeneric() {
    return ["(not-generic)", Never()];
  }
  function FromGeneric(name, parameters, expression) {
    return [name, Generic(parameters, expression)];
  }
  function FromRef4(context, ref, arguments_) {
    return ref in context ? FromType6(context, ref, context[ref], arguments_) : FromNotResolvable();
  }
  function FromType6(context, name, target, arguments_) {
    return IsGeneric(target) ? FromGeneric(name, target.parameters, target.expression) : IsRef(target) ? FromRef4(context, target.$ref, arguments_) : FromNotGeneric();
  }
  function ResolveTarget(context, target, arguments_) {
    return FromType6(context, "(anonymous)", target, arguments_);
  }


  function AssertArgumentExtends(name, type2, extends_) {
    if (IsInfer(type2) || IsCall(type2) || result_exports.IsExtendsTrueLike(Extends({}, type2, extends_)))
      return;
    const cause = { parameter: name, expect: extends_, actual: type2 };
    throw new Error(`Argument for parameter ${name} does not satisfy constraint`, { cause });
  }
  function BindArgument(context, state2, name, extends_, type2) {
    const instantiatedArgument = InstantiateType(context, state2, type2);
    AssertArgumentExtends(name, instantiatedArgument, extends_);
    return memory_exports.Assign(context, { [name]: instantiatedArgument });
  }
  function BindArguments(context, state2, parameterLeft, parameterRight, arguments_) {
    const instantiatedExtends = InstantiateType(context, state2, parameterLeft.extends);
    const instantiatedEquals = InstantiateType(context, state2, parameterLeft.equals);
    return guard_exports.ShiftLeft(arguments_, (left, right) => BindParameters(BindArgument(context, state2, parameterLeft["name"], instantiatedExtends, left), state2, parameterRight, right), () => BindParameters(BindArgument(context, state2, parameterLeft["name"], instantiatedExtends, instantiatedEquals), state2, parameterRight, []));
  }
  function BindParameters(context, state2, parameters, arguments_) {
    return guard_exports.ShiftLeft(parameters, (left, right) => BindArguments(context, state2, left, right, arguments_), () => context);
  }
  function ResolveArgumentsContext(context, state2, parameters, arguments_) {
    return BindParameters(context, state2, parameters, arguments_);
  }


  var instantiationDepth = 0;
  var instantiationCount = 0;
  function InstantiationAssert() {
    if (guard_exports.IsLessThan(instantiationCount, settings_exports.Get().maxInstantiationCount))
      return;
    throw Error("Type instantiation is excessively deep and possibly infinite");
  }
  function InstantiationIncrement() {
    InstantiationAssert();
    instantiationCount++;
    instantiationDepth++;
  }
  function InstantiationDecrement() {
    instantiationDepth--;
    if (guard_exports.IsEqual(instantiationDepth, 0))
      instantiationCount = 0;
  }
  function Peek(state2) {
    const result = guard_exports.IsGreaterThan(state2.callstack.length, 0) ? state2.callstack[state2.callstack.length - 1] : "";
    return result;
  }
  function IsTailCall(state2, name) {
    const result = guard_exports.IsEqual(Peek(state2), name);
    return result;
  }
  function CallDispatch(context, state2, target, parameters, expression, arguments_) {
    InstantiationIncrement();
    try {
      const argumentsContext = ResolveArgumentsContext(context, state2, parameters, arguments_);
      const returnType = InstantiateType(argumentsContext, State([...state2["callstack"], target["$ref"]], state2["visited"]), expression);
      return InstantiateType(argumentsContext, State([], []), returnType);
    } finally {
      InstantiationDecrement();
    }
  }
  function CallDistributed(context, state2, target, parameters, expression, distributedArguments) {
    return distributedArguments.reduce((result, arguments_) => {
      const returnType = CallDispatch(context, state2, target, parameters, expression, arguments_);
      return [...result, returnType];
    }, []);
  }
  function CallImmediate(context, state2, target, parameters, expression, arguments_) {
    const distributedArguments = DistributeArguments(parameters, arguments_, expression);
    const returnTypes = CallDistributed(context, state2, target, parameters, expression, distributedArguments);
    const result = guard_exports.IsEqual(returnTypes.length, 1) ? returnTypes[0] : EvaluateUnion(returnTypes);
    return result;
  }
  function CallInstantiate(context, state2, target, arguments_) {
    const instantiatedArguments = InstantiateTypes(context, state2, arguments_);
    const resolved = ResolveTarget(context, target, arguments_);
    const name = resolved[0];
    const type2 = resolved[1];
    const result = IsGeneric(type2) ? IsTailCall(state2, name) ? CallConstruct(Ref(name), instantiatedArguments) : CallImmediate(context, state2, Ref(name), type2.parameters, type2.expression, instantiatedArguments) : CallConstruct(target, instantiatedArguments);
    return result;
  }


  function CallConstruct(target, arguments_) {
    return memory_exports.Create({ ["~kind"]: "Call" }, { type: "call", target, arguments: arguments_ }, {});
  }
  function Call2(target, arguments_) {
    return CallInstantiate({}, State([], []), target, arguments_);
  }
  function IsCall(value) {
    return IsKind(value, "Call");
  }


  function RemoveImmutableOperation(type2) {
    return memory_exports.Discard(type2, ["~immutable"]);
  }
  function RemoveImmutableAction(type2, options) {
    const result = memory_exports.Update(RemoveImmutableOperation(type2), {}, options);
    return result;
  }
  function RemoveImmutableInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return RemoveImmutableAction(instantiatedType, options);
  }


  function ApplyMapping(mapping, value) {
    return mapping(value);
  }


  function FromLiteral3(mapping, value) {
    return guard_exports.IsString(value) ? Literal(ApplyMapping(mapping, value)) : Literal(value);
  }


  function FromTemplateLiteral(mapping, pattern) {
    const evaluated = EvaluateTemplateLiteral(pattern);
    const result = FromType7(mapping, evaluated);
    return result;
  }


  function FromUnion2(mapping, types2) {
    const result = types2.map((type2) => FromType7(mapping, type2));
    return Union(result);
  }


  function FromType7(mapping, type2) {
    return IsLiteral(type2) ? FromLiteral3(mapping, type2.const) : IsTemplateLiteral(type2) ? FromTemplateLiteral(mapping, type2.pattern) : IsUnion(type2) ? FromUnion2(mapping, type2.anyOf) : type2;
  }


  function CapitalizeDeferred(type2, options = {}) {
    return Deferred("Capitalize", [type2], options);
  }
  function Capitalize(type2, options = {}) {
    return CapitalizeAction(type2, options);
  }


  function LowercaseDeferred(type2, options = {}) {
    return Deferred("Lowercase", [type2], options);
  }
  function Lowercase(type2, options = {}) {
    return LowercaseAction(type2, options);
  }


  function UncapitalizeDeferred(type2, options = {}) {
    return Deferred("Uncapitalize", [type2], options);
  }
  function Uncapitalize(type2, options = {}) {
    return UncapitalizeAction(type2, options);
  }


  function UppercaseDeferred(type2, options = {}) {
    return Deferred("Uppercase", [type2], options);
  }
  function Uppercase(type2, options = {}) {
    return UppercaseAction(type2, options);
  }


  var CapitalizeMapping = (input) => input[0].toUpperCase() + input.slice(1);
  var LowercaseMapping = (input) => input.toLowerCase();
  var UncapitalizeMapping = (input) => input[0].toLowerCase() + input.slice(1);
  var UppercaseMapping = (input) => input.toUpperCase();
  function CapitalizeAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(FromType7(CapitalizeMapping, type2), {}, options) : CapitalizeDeferred(type2, options);
    return result;
  }
  function LowercaseAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(FromType7(LowercaseMapping, type2), {}, options) : LowercaseDeferred(type2, options);
    return result;
  }
  function UncapitalizeAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(FromType7(UncapitalizeMapping, type2), {}, options) : UncapitalizeDeferred(type2, options);
    return result;
  }
  function UppercaseAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(FromType7(UppercaseMapping, type2), {}, options) : UppercaseDeferred(type2, options);
    return result;
  }
  function CapitalizeInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return CapitalizeAction(instantiatedType, options);
  }
  function LowercaseInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return LowercaseAction(instantiatedType, options);
  }
  function UncapitalizeInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return UncapitalizeAction(instantiatedType, options);
  }
  function UppercaseInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return UppercaseAction(instantiatedType, options);
  }


  function ConditionalDeferred(left, right, true_, false_, options = {}) {
    return Deferred("Conditional", [left, right, true_, false_], options);
  }
  function Conditional(left, right, true_, false_, options = {}) {
    return ConditionalAction({}, State([], []), left, right, true_, false_, options);
  }


  function ConditionalOperation(context, state2, left, right, true_, false_) {
    const extendsResult = Extends(context, left, right);
    return result_exports.IsExtendsUnion(extendsResult) ? Union([InstantiateType(extendsResult.inferred, state2, true_), InstantiateType(context, state2, false_)]) : result_exports.IsExtendsTrue(extendsResult) ? InstantiateType(extendsResult.inferred, state2, true_) : InstantiateType(context, state2, false_);
  }
  function ConditionalAction(context, state2, left, right, true_, false_, options) {
    const result = CanInstantiate([left, right]) ? memory_exports.Update(ConditionalOperation(context, state2, left, right, true_, false_), {}, options) : ConditionalDeferred(left, right, true_, false_, options);
    return result;
  }
  function ConditionalInstantiate(context, state2, left, right, true_, false_, options) {
    const instantiatedLeft = InstantiateType(context, state2, left);
    const instantiatedRight = InstantiateType(context, state2, right);
    return ConditionalAction(context, state2, instantiatedLeft, instantiatedRight, true_, false_, options);
  }


  function ConstructorParametersDeferred(type2, options = {}) {
    return Deferred("ConstructorParameters", [type2], options);
  }
  function ConstructorParameters(type2, options = {}) {
    return ConstructorParametersAction(type2, options);
  }


  function ConstructorParametersOperation(type2) {
    const parameters = IsConstructor3(type2) ? type2["parameters"] : [];
    const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
    const result = Tuple(instantiatedParameters);
    return result;
  }
  function ConstructorParametersAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(ConstructorParametersOperation(type2), {}, options) : ConstructorParametersDeferred(type2, options);
    return result;
  }
  function ConstructorParametersInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return ConstructorParametersAction(instantiatedType, options);
  }


  function ExcludeDeferred(left, right, options = {}) {
    return Deferred("Exclude", [left, right], options);
  }
  function Exclude(left, right, options = {}) {
    return ExcludeAction(left, right, options);
  }


  function ExcludeAction(left, right, options) {
    const result = CanInstantiate([left, right]) ? memory_exports.Update(ExcludeOperation(left, right), {}, options) : ExcludeDeferred(left, right, options);
    return result;
  }
  function ExcludeInstantiate(context, state2, left, right, options) {
    const instantiatedLeft = InstantiateType(context, state2, left);
    const instantiatedRight = InstantiateType(context, state2, right);
    return ExcludeAction(instantiatedLeft, instantiatedRight, options);
  }


  function ExtractDeferred(left, right, options = {}) {
    return Deferred("Extract", [left, right], options);
  }
  function Extract(left, right, options = {}) {
    return ExtractAction(left, right, options);
  }


  function ExtractType(left, right) {
    const check = Extends({}, left, right);
    const result = result_exports.IsExtendsTrueLike(check) ? [left] : [];
    return result;
  }
  function ExtractUnion(left, right, result = []) {
    return guard_exports.ShiftLeft(left, (head, tail) => ExtractUnion(tail, right, [...result, ...ExtractType(head, right)]), () => result);
  }
  function ExtractOperation(left, right) {
    const evaluated = EvaluateType(left);
    const canonical = IsUnion(evaluated) ? evaluated.anyOf : [evaluated];
    const remaining = ExtractUnion(canonical, right);
    const result = EvaluateUnion(remaining);
    return result;
  }


  function ExtractAction(left, right, options) {
    const result = CanInstantiate([left, right]) ? memory_exports.Update(ExtractOperation(left, right), {}, options) : ExtractDeferred(left, right, options);
    return result;
  }
  function ExtractInstantiate(context, state2, left, right, options) {
    const instantiatedLeft = InstantiateType(context, state2, left);
    const instantiatedRight = InstantiateType(context, state2, right);
    return ExtractAction(instantiatedLeft, instantiatedRight, options);
  }


  function KeysToLiterals(keys) {
    return keys.reduce((result, left) => {
      return IsLiteralValue(left) ? [...result, Literal(left)] : result;
    }, []);
  }
  function KeysToIndexer(keys) {
    const literals = KeysToLiterals(keys);
    const result = Union(literals);
    return result;
  }


  function IndexDeferred(type2, indexer, options = {}) {
    return Deferred("Index", [type2, indexer], options);
  }
  function Index(type2, indexer_or_keys, options = {}) {
    const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
    return IndexAction(type2, indexer, options);
  }


  function FromCyclic(defs, ref) {
    const target = CyclicTarget(defs, ref);
    const result = FromType8(target);
    return result;
  }


  function FromDependent(if_, then_, else_) {
    const evaluated = EvaluateDependent(if_, then_, else_);
    const result = FromType8(evaluated);
    return result;
  }


  function CollapseIntersectProperties(left, right) {
    const leftKeys = guard_exports.Keys(left).filter((key) => !guard_exports.HasPropertyKey(right, key));
    const rightKeys = guard_exports.Keys(right).filter((key) => !guard_exports.HasPropertyKey(left, key));
    const sharedKeys = guard_exports.Keys(left).filter((key) => guard_exports.HasPropertyKey(right, key));
    const leftProperties = leftKeys.reduce((result, key) => ({ ...result, [key]: left[key] }), {});
    const rightProperties = rightKeys.reduce((result, key) => ({ ...result, [key]: right[key] }), {});
    const sharedProperties = sharedKeys.reduce((result, key) => ({ ...result, [key]: EvaluateIntersect([left[key], right[key]]) }), {});
    const unique = memory_exports.Assign(leftProperties, rightProperties);
    const shared = memory_exports.Assign(unique, sharedProperties);
    return shared;
  }
  function FromIntersect(types2) {
    return types2.reduce((result, left) => {
      return CollapseIntersectProperties(result, FromType8(left));
    }, {});
  }


  function FromObject4(properties) {
    return properties;
  }


  function FromTuple(types2) {
    const object = TupleToObject(Tuple(types2));
    const result = FromType8(object);
    return result;
  }


  function CollapseUnionProperties(left, right) {
    const sharedKeys = guard_exports.Keys(left).filter((key) => key in right);
    const result = sharedKeys.reduce((result2, key) => {
      return { ...result2, [key]: EvaluateUnion([left[key], right[key]]) };
    }, {});
    return result;
  }
  function ReduceVariants(types2, result) {
    return guard_exports.ShiftLeft(types2, (left, right) => ReduceVariants(right, CollapseUnionProperties(result, FromType8(left))), () => result);
  }
  function FromUnion3(types2) {
    return guard_exports.ShiftLeft(types2, (left, right) => ReduceVariants(right, FromType8(left)), () => Unreachable());
  }


  function FromType8(type2) {
    return IsCyclic(type2) ? FromCyclic(type2.$defs, type2.$ref) : IsDependent(type2) ? FromDependent(type2.if, type2.then, type2.else) : IsIntersect(type2) ? FromIntersect(type2.allOf) : IsUnion(type2) ? FromUnion3(type2.anyOf) : IsTuple(type2) ? FromTuple(type2.items) : IsObject3(type2) ? FromObject4(type2.properties) : {};
  }


  function CollapseToObject(type2) {
    const properties = FromType8(type2);
    const result = _Object_(properties);
    return result;
  }


  var integerKeyPattern = new RegExp("^(?:0|[1-9][0-9]*)$");
  function ConvertToIntegerKey(value) {
    const normal = `${value}`;
    return integerKeyPattern.test(normal) ? parseInt(normal) : value;
  }


  function NormalizeLiteral(value) {
    return Literal(ConvertToIntegerKey(value));
  }
  function NormalizeIndexerTypes(types2) {
    return types2.map((type2) => NormalizeIndexer(type2));
  }
  function NormalizeIndexer(type2) {
    return IsIntersect(type2) ? Intersect(NormalizeIndexerTypes(type2.allOf)) : IsUnion(type2) ? Union(NormalizeIndexerTypes(type2.anyOf)) : IsLiteral(type2) ? NormalizeLiteral(type2.const) : type2;
  }
  function FromArray3(type2, indexer) {
    const normalizedIndexer = NormalizeIndexer(indexer);
    const check = Extends({}, normalizedIndexer, Number2());
    const result = (
      // indexer
      result_exports.IsExtendsTrueLike(check) ? type2 : IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Number2() : Never()
    );
    return result;
  }


  function FromCyclic2(defs, ref) {
    const target = CyclicTarget(defs, ref);
    const result = FromType9(target);
    return result;
  }


  function FromDependent2(if_, then_, else_) {
    const evaluated = EvaluateDependent(if_, then_, else_);
    const result = FromType9(evaluated);
    return result;
  }


  function FromEnum(values) {
    const evaluated = EvaluateEnum(values);
    const result = FromType9(evaluated);
    return result;
  }


  function FromIntersect2(types2) {
    const evaluated = EvaluateIntersect(types2);
    const result = FromType9(evaluated);
    return result;
  }


  function FromLiteral4(value) {
    const result = [`${value}`];
    return result;
  }


  function FromTemplateLiteral2(pattern) {
    const evaluated = EvaluateTemplateLiteral(pattern);
    const result = FromType9(evaluated);
    return result;
  }


  function FromUnion4(types2) {
    return types2.reduce((result, left) => {
      return [...result, ...FromType9(left)];
    }, []);
  }


  function FromType9(type2) {
    return IsCyclic(type2) ? FromCyclic2(type2.$defs, type2.$ref) : IsDependent(type2) ? FromDependent2(type2.if, type2.then, type2.else) : IsEnum(type2) ? FromEnum(type2.enum) : IsIntersect(type2) ? FromIntersect2(type2.allOf) : IsLiteral(type2) ? FromLiteral4(type2.const) : IsTemplateLiteral(type2) ? FromTemplateLiteral2(type2.pattern) : IsUnion(type2) ? FromUnion4(type2.anyOf) : [];
  }


  function ToIndexableKeys(type2) {
    const result = FromType9(type2);
    return result;
  }


  function FromTypes5(properties, types2) {
    return types2.map((type2) => FromType10(properties, type2));
  }
  function FromType10(properties, type2) {
    return IsArray3(type2) ? _Array_(FromType10(properties, type2.items)) : IsConstructor3(type2) ? Constructor(FromTypes5(properties, type2.parameters), FromType10(properties, type2.instanceType)) : IsFunction3(type2) ? _Function_(FromTypes5(properties, type2.parameters), FromType10(properties, type2.returnType)) : IsTuple(type2) ? Tuple(FromTypes5(properties, type2.items)) : IsUnion(type2) ? Union(FromTypes5(properties, type2.anyOf)) : IsIntersect(type2) ? Intersect(FromTypes5(properties, type2.allOf)) : IsThis(type2) ? _Object_(properties) : type2;
  }
  function ExpandThis(properties, type2) {
    const result = FromType10(properties, type2);
    return result;
  }


  function IndexProperty(properties, key) {
    const selectedType = key in properties ? properties[key] : Never();
    const result = ExpandThis(properties, selectedType);
    return result;
  }
  function IndexProperties(properties, keys) {
    return keys.reduce((result, left) => {
      return [...result, IndexProperty(properties, left)];
    }, []);
  }
  function FromIndexer(properties, indexer) {
    const keys = ToIndexableKeys(indexer);
    const variants = IndexProperties(properties, keys);
    const result = EvaluateUnion(variants);
    return result;
  }
  var NumericKeyPattern = new RegExp(IntegerKey);
  function NumericKeys(keys) {
    const result = keys.filter((key) => NumericKeyPattern.test(key));
    return result;
  }
  function FromIndexerNumber(properties) {
    const keys = PropertyKeys(properties);
    const numericKeys = NumericKeys(keys);
    const variants = IndexProperties(properties, numericKeys);
    const result = EvaluateUnion(variants);
    return result;
  }
  function FromObject5(properties, indexer) {
    const result = IsNumber4(indexer) ? FromIndexerNumber(properties) : FromIndexer(properties, indexer);
    return result;
  }


  function ConvertLiteral(value) {
    return Literal(ConvertToIntegerKey(value));
  }
  function ArrayIndexerTypes(types2) {
    return types2.map((type2) => FormatArrayIndexer(type2));
  }
  function FormatArrayIndexer(type2) {
    return IsIntersect(type2) ? Intersect(ArrayIndexerTypes(type2.allOf)) : IsUnion(type2) ? Union(ArrayIndexerTypes(type2.anyOf)) : IsLiteral(type2) ? ConvertLiteral(type2.const) : type2;
  }


  function IndexElementsWithIndexer(types2, indexer) {
    return types2.reduceRight((result, right, index3) => {
      const check = Extends({}, Literal(index3), indexer);
      return result_exports.IsExtendsTrueLike(check) ? [right, ...result] : result;
    }, []);
  }
  function FromTupleWithIndexer(types2, indexer) {
    const formattedArrayIndexer = FormatArrayIndexer(indexer);
    const elements = IndexElementsWithIndexer(types2, formattedArrayIndexer);
    return EvaluateUnionFast(elements);
  }
  function FromTupleWithoutIndexer(types2) {
    return EvaluateUnionFast(types2);
  }
  function FromTuple2(types2, indexer) {
    return (
      // length (intrinsic)
      IsLiteral(indexer) && guard_exports.IsEqual(indexer.const, "length") ? Literal(types2.length) : IsNumber4(indexer) || IsInteger3(indexer) ? FromTupleWithoutIndexer(types2) : FromTupleWithIndexer(types2, indexer)
    );
  }


  function FromType11(type2, indexer) {
    return IsArray3(type2) ? FromArray3(type2.items, indexer) : IsObject3(type2) ? FromObject5(type2.properties, indexer) : IsTuple(type2) ? FromTuple2(type2.items, indexer) : Never();
  }


  function NormalizeType(type2) {
    const result = IsCyclic(type2) || IsDependent(type2) || IsIntersect(type2) || IsUnion(type2) ? CollapseToObject(type2) : type2;
    return result;
  }
  function IndexAction(type2, indexer, options) {
    const result = CanInstantiate([type2, indexer]) ? memory_exports.Update(FromType11(NormalizeType(type2), indexer), {}, options) : IndexDeferred(type2, indexer, options);
    return result;
  }
  function IndexInstantiate(context, state2, type2, indexer, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    const instantiatedIndexer = InstantiateType(context, state2, indexer);
    return IndexAction(instantiatedType, instantiatedIndexer, options);
  }


  function InstanceTypeDeferred(type2, options = {}) {
    return Deferred("InstanceType", [type2], options);
  }
  function InstanceType(type2, options = {}) {
    return InstanceTypeAction(type2, options);
  }


  function InstanceTypeOperation(type2) {
    return IsConstructor3(type2) ? type2["instanceType"] : Never();
  }
  function InstanceTypeAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(InstanceTypeOperation(type2), {}, options) : InstanceTypeDeferred(type2, options);
    return result;
  }
  function InstanceTypeInstantiate(context, state2, type2, options = {}) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return InstanceTypeAction(instantiatedType, options);
  }


  function KeyOfDeferred(type2, options = {}) {
    return Deferred("KeyOf", [type2], options);
  }
  function KeyOf2(type2, options = {}) {
    return KeyOfAction(type2, options);
  }


  function FromAny() {
    return Union([Number2(), String2(), Symbol2()]);
  }


  function FromArray4(_type) {
    return Number2();
  }


  function FromPropertyKeys(keys) {
    const result = keys.reduce((result2, left) => {
      return IsLiteralValue(left) ? [...result2, Literal(ConvertToIntegerKey(left))] : Unreachable();
    }, []);
    return result;
  }
  function FromObject6(properties) {
    const propertyKeys = guard_exports.Keys(properties);
    const variants = FromPropertyKeys(propertyKeys);
    const result = EvaluateUnionFast(variants);
    return result;
  }


  function FromRecord2(type2) {
    return RecordKey(type2);
  }


  function FromTuple3(types2) {
    const result = types2.map((_, index3) => Literal(index3));
    return EvaluateUnionFast(result);
  }


  function FromType12(type2) {
    return IsAny(type2) ? FromAny() : IsArray3(type2) ? FromArray4(type2.items) : IsObject3(type2) ? FromObject6(type2.properties) : IsRecord(type2) ? FromRecord2(type2) : IsTuple(type2) ? FromTuple3(type2.items) : Never();
  }


  function NormalizeType2(type2) {
    const result = IsCyclic(type2) || IsDependent(type2) || IsIntersect(type2) || IsUnion(type2) ? CollapseToObject(type2) : type2;
    return result;
  }
  function KeyOfAction(type2, options) {
    return CanInstantiate([type2]) ? memory_exports.Update(FromType12(NormalizeType2(type2)), {}, options) : KeyOfDeferred(type2, options);
  }
  function KeyOfInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return KeyOfAction(instantiatedType, options);
  }


  function MappedDeferred(identifier, type2, as, property, options = {}) {
    return Deferred("Mapped", [identifier, type2, as, property], options);
  }
  function Mapped(identifier, type2, as, property, options = {}) {
    return MappedAction({}, State([], []), identifier, type2, as, property, options);
  }


  function FromTemplateLiteral3(pattern) {
    const evaluated = EvaluateTemplateLiteral(pattern);
    const result = FromType13(evaluated);
    return result;
  }
  function FromUnion5(types2) {
    return types2.reduce((result, left) => {
      return [...result, ...FromType13(left)];
    }, []);
  }
  function FromEnum2(values) {
    const evaluated = EvaluateEnum(values);
    const result = FromType13(evaluated);
    return result;
  }
  function FromLiteral5(value) {
    const result = guard_exports.IsNumber(value) ? [Literal(`${value}`)] : [Literal(value)];
    return result;
  }
  function FromType13(type2) {
    const result = IsEnum(type2) ? FromEnum2(type2.enum) : IsLiteral(type2) ? FromLiteral5(type2.const) : IsTemplateLiteral(type2) ? FromTemplateLiteral3(type2.pattern) : IsUnion(type2) ? FromUnion5(type2.anyOf) : [type2];
    return result;
  }
  function MappedVariants(type2) {
    const result = FromType13(type2);
    return result;
  }


  function CanonicalAs(instantiatedAs) {
    const result = IsTemplateLiteral(instantiatedAs) ? EvaluateTemplateLiteral(instantiatedAs.pattern) : instantiatedAs;
    return result;
  }
  function MappedVariant(context, state2, identifier, variant2, as, property) {
    const variantContext = memory_exports.Assign(context, { [identifier["name"]]: variant2 });
    const instantiatedAs = InstantiateType(variantContext, state2, as);
    const canonicalAs = CanonicalAs(instantiatedAs);
    const instantiatedProperty = InstantiateType(variantContext, state2, property);
    return IsLiteralNumber(canonicalAs) || IsLiteralString(canonicalAs) ? { [canonicalAs.const]: instantiatedProperty } : {};
  }
  function MappedProperties(context, state2, identifier, variants, as, property) {
    return variants.reduce((result, left) => {
      return [...result, MappedVariant(context, state2, identifier, left, as, property)];
    }, []);
  }
  function MappedObjects(properties) {
    return properties.reduce((result, left) => {
      return [...result, _Object_(left)];
    }, []);
  }
  function MappedOperation(context, state2, identifier, type2, as, property) {
    const variants = MappedVariants(type2);
    const mappedProperties = MappedProperties(context, state2, identifier, variants, as, property);
    const mappedObjects = MappedObjects(mappedProperties);
    const result = EvaluateIntersect(mappedObjects);
    return result;
  }


  function MappedAction(context, state2, identifier, type2, as, property, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(MappedOperation(context, state2, identifier, type2, as, property), {}, options) : MappedDeferred(identifier, type2, as, property, options);
    return result;
  }
  function MappedInstantiate(context, state2, identifier, type2, as, property, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return MappedAction(context, state2, identifier, instantiatedType, as, property, options);
  }


  function InstantiateCyclics(context, declarations, cyclicKeys) {
    const declarationContext = memory_exports.Assign(context, declarations);
    const declarationKeys = guard_exports.Keys(declarations).filter((key) => cyclicKeys.includes(key));
    return declarationKeys.reduce((result, key) => {
      return { ...result, [key]: InstantiateCyclic(declarationContext, key, declarations[key]) };
    }, {});
  }
  function InstantiateNonCyclics(context, declarations, cyclicKeys) {
    const declarationContext = memory_exports.Assign(context, declarations);
    const declarationKeys = guard_exports.Keys(declarations).filter((key) => !cyclicKeys.includes(key));
    return declarationKeys.reduce((result, key) => {
      return { ...result, [key]: InstantiateType(declarationContext, State([], []), declarations[key]) };
    }, {});
  }
  function InstantiateModule(context, declarations, options) {
    const cyclicCandidates = CyclicCandidates(declarations);
    const instantiatedCyclics = InstantiateCyclics(context, declarations, cyclicCandidates);
    const instantiatedNonCyclics = InstantiateNonCyclics(context, declarations, cyclicCandidates);
    const instantiatedModule = { ...instantiatedCyclics, ...instantiatedNonCyclics };
    return memory_exports.Update(instantiatedModule, {}, options);
  }
  function ModuleInstantiate(context, _state, declarations, options) {
    const instantiatedModule = InstantiateModule(context, declarations, options);
    return instantiatedModule;
  }


  function NonNullableDeferred(type2, options = {}) {
    return Deferred("NonNullable", [type2], options);
  }
  function NonNullable(type2, options = {}) {
    return NonNullableAction(type2, options);
  }


  function NonNullableOperation(type2) {
    const excluded = Union([Null(), Undefined()]);
    return ExcludeAction(type2, excluded, {});
  }
  function NonNullableAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(NonNullableOperation(type2), {}, options) : NonNullableDeferred(type2, options);
    return result;
  }
  function NonNullableInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return NonNullableAction(instantiatedType, options);
  }


  function OmitDeferred(type2, indexer, options = {}) {
    return Deferred("Omit", [type2, indexer], options);
  }
  function Omit(type2, indexer_or_keys, options = {}) {
    const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
    return OmitAction(type2, indexer, options);
  }


  function ToIndexable(type2) {
    const collapsed = CollapseToObject(type2);
    const result = IsObject3(collapsed) ? collapsed.properties : Unreachable();
    return result;
  }


  function FromKeys(properties, keys) {
    const result = guard_exports.Keys(properties).reduce((result2, key) => {
      return keys.includes(key) ? result2 : { ...result2, [key]: properties[key] };
    }, {});
    return result;
  }
  function FromType14(type2, indexer) {
    const indexable = ToIndexable(type2);
    const indexableKeys = ToIndexableKeys(indexer);
    const omitted = FromKeys(indexable, indexableKeys);
    const result = _Object_(omitted);
    return result;
  }


  function OmitAction(type2, indexer, options) {
    const result = CanInstantiate([type2, indexer]) ? memory_exports.Update(FromType14(type2, indexer), {}, options) : OmitDeferred(type2, indexer, options);
    return result;
  }
  function OmitInstantiate(context, state2, type2, indexer, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    const instantiatedIndexer = InstantiateType(context, state2, indexer);
    return OmitAction(instantiatedType, instantiatedIndexer, options);
  }


  function ParametersDeferred(type2, options = {}) {
    return Deferred("Parameters", [type2], options);
  }
  function Parameters(type2, options = {}) {
    return ParametersAction(type2, options);
  }


  function ParametersOperation(type2) {
    const parameters = IsFunction3(type2) ? type2["parameters"] : [];
    const instantiatedParameters = InstantiateElements({}, State([], []), parameters);
    const result = Tuple(instantiatedParameters);
    return result;
  }
  function ParametersAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(ParametersOperation(type2), {}, options) : ParametersDeferred(type2, options);
    return result;
  }
  function ParametersInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return ParametersAction(instantiatedType, options);
  }


  function PartialDeferred(type2, options = {}) {
    return Deferred("Partial", [type2], options);
  }
  function Partial(type2, options = {}) {
    return PartialAction(type2, options);
  }


  function FromCyclic3(defs, ref) {
    const target = CyclicTarget(defs, ref);
    const partial = FromType15(target);
    const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
    return result;
  }


  function FromDependent3(if_, then_, else_) {
    const evaluated = EvaluateDependent(if_, then_, else_);
    const result = FromType15(evaluated);
    return result;
  }


  function FromIntersect3(types2) {
    const evaluated = EvaluateIntersect(types2);
    const result = FromType15(evaluated);
    return result;
  }


  function FromUnion6(types2) {
    const result = types2.map((type2) => FromType15(type2));
    return Union(result);
  }


  function FromObject7(properties) {
    const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
      return { ...result2, [left]: AddOptional(properties[left]) };
    }, {});
    const result = _Object_(mapped);
    return result;
  }


  function FromType15(type2) {
    return IsCyclic(type2) ? FromCyclic3(type2.$defs, type2.$ref) : IsDependent(type2) ? FromDependent3(type2.if, type2.then, type2.else) : IsIntersect(type2) ? FromIntersect3(type2.allOf) : IsUnion(type2) ? FromUnion6(type2.anyOf) : IsObject3(type2) ? FromObject7(type2.properties) : _Object_({});
  }


  function PartialAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(FromType15(type2), {}, options) : PartialDeferred(type2, options);
    return result;
  }
  function PartialInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return PartialAction(instantiatedType, options);
  }


  function PickDeferred(type2, indexer, options = {}) {
    return Deferred("Pick", [type2, indexer], options);
  }
  function Pick(type2, indexer_or_keys, options = {}) {
    const indexer = guard_exports.IsArray(indexer_or_keys) ? KeysToIndexer(indexer_or_keys) : indexer_or_keys;
    return PickAction(type2, indexer, options);
  }


  function FromKeys2(properties, keys) {
    const result = guard_exports.Keys(properties).reduce((result2, key) => {
      return keys.includes(key) ? memory_exports.Assign(result2, { [key]: properties[key] }) : result2;
    }, {});
    return result;
  }
  function FromType16(type2, indexer) {
    const indexable = ToIndexable(type2);
    const keys = ToIndexableKeys(indexer);
    const applied = FromKeys2(indexable, keys);
    const result = _Object_(applied);
    return result;
  }


  function PickAction(type2, indexer, options) {
    const result = CanInstantiate([type2, indexer]) ? memory_exports.Update(FromType16(type2, indexer), {}, options) : PickDeferred(type2, indexer, options);
    return result;
  }
  function PickInstantiate(context, state2, type2, indexer, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    const instantiatedIndexer = InstantiateType(context, state2, indexer);
    return PickAction(instantiatedType, instantiatedIndexer, options);
  }


  function ReadonlyObjectDeferred(type2, options = {}) {
    return Deferred("ReadonlyObject", [type2], options);
  }
  function ReadonlyObject(type2, options = {}) {
    return ReadonlyObjectAction(type2, options);
  }
  var ReadonlyType = ReadonlyObject;


  function FromArray5(type2) {
    const result = AddImmutable(_Array_(type2));
    return result;
  }


  function FromCyclic4(defs, ref) {
    const target = CyclicTarget(defs, ref);
    const partial = FromType17(target);
    const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
    return result;
  }


  function FromDependent4(if_, then_, else_) {
    const evaluated = EvaluateDependent(if_, then_, else_);
    const result = FromType17(evaluated);
    return result;
  }


  function FromIntersect4(types2) {
    const evaluated = EvaluateIntersect(types2);
    const result = FromType17(evaluated);
    return result;
  }


  function FromObject8(properties) {
    const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
      return { ...result2, [left]: AddReadonly(properties[left]) };
    }, {});
    const result = _Object_(mapped);
    return result;
  }


  function FromTuple4(types2) {
    const result = AddImmutable(Tuple(types2));
    return result;
  }


  function FromUnion7(types2) {
    const result = types2.map((type2) => FromType17(type2));
    return Union(result);
  }


  function FromType17(type2) {
    return IsArray3(type2) ? FromArray5(type2.items) : IsCyclic(type2) ? FromCyclic4(type2.$defs, type2.$ref) : IsDependent(type2) ? FromDependent4(type2.if, type2.then, type2.else) : IsIntersect(type2) ? FromIntersect4(type2.allOf) : IsObject3(type2) ? FromObject8(type2.properties) : IsTuple(type2) ? FromTuple4(type2.items) : IsUnion(type2) ? FromUnion7(type2.anyOf) : type2;
  }


  function ReadonlyObjectAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(FromType17(type2), {}, options) : ReadonlyObjectDeferred(type2);
    return result;
  }
  function ReadonlyObjectInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return ReadonlyObjectAction(instantiatedType, options);
  }


  function RefInstantiate(context, state2, type2, ref) {
    return state2.visited.includes(ref) ? type2 : ref in context ? InstantiateType(context, State(state2["callstack"], [...state2["visited"], ref]), context[ref]) : type2;
  }


  function FromCyclic5(defs, ref) {
    const target = CyclicTarget(defs, ref);
    const partial = FromType18(target);
    const result = Cyclic(memory_exports.Assign(defs, { [ref]: partial }), ref);
    return result;
  }


  function FromDependent5(if_, then_, else_) {
    const evaluated = EvaluateDependent(if_, then_, else_);
    const result = FromType18(evaluated);
    return result;
  }


  function FromIntersect5(types2) {
    const evaluated = EvaluateIntersect(types2);
    const result = FromType18(evaluated);
    return result;
  }


  function FromUnion8(types2) {
    const result = types2.map((type2) => FromType18(type2));
    return Union(result);
  }


  function FromObject9(properties) {
    const mapped = guard_exports.Keys(properties).reduce((result2, left) => {
      return { ...result2, [left]: RemoveOptional(properties[left]) };
    }, {});
    const result = _Object_(mapped);
    return result;
  }


  function FromType18(type2) {
    return IsCyclic(type2) ? FromCyclic5(type2.$defs, type2.$ref) : IsDependent(type2) ? FromDependent5(type2.if, type2.then, type2.else) : IsIntersect(type2) ? FromIntersect5(type2.allOf) : IsUnion(type2) ? FromUnion8(type2.anyOf) : IsObject3(type2) ? FromObject9(type2.properties) : _Object_({});
  }


  function RequiredDeferred(type2, options = {}) {
    return Deferred("Required", [type2], options);
  }
  function Required(type2, options = {}) {
    return RequiredAction(type2, options);
  }


  function RequiredAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(FromType18(type2), {}, options) : RequiredDeferred(type2, options);
    return result;
  }
  function RequiredInstantiate(context, state2, type2, options) {
    const instaniatedType = InstantiateType(context, state2, type2);
    return RequiredAction(instaniatedType, options);
  }


  function ReturnTypeDeferred(type2, options = {}) {
    return Deferred("ReturnType", [type2], options);
  }
  function ReturnType(type2, options = {}) {
    return ReturnTypeAction(type2, options);
  }


  function ReturnTypeOperation(type2) {
    return IsFunction3(type2) ? type2["returnType"] : Never();
  }
  function ReturnTypeAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(ReturnTypeOperation(type2), {}, options) : ReturnTypeDeferred(type2, options);
    return result;
  }
  function ReturnTypeInstantiate(context, state2, type2, options = {}) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return ReturnTypeAction(instantiatedType, options);
  }


  function WithDeferred(type2, options) {
    return Deferred("With", [type2, options], {});
  }
  function With2(type2, options) {
    return WithAction(type2, options);
  }


  function WithAction(type2, options) {
    const result = CanInstantiate([type2]) ? memory_exports.Update(type2, {}, options) : WithDeferred(type2, options);
    return result;
  }
  function WithInstantiate(context, state2, type2, options) {
    const instaniatedType = InstantiateType(context, state2, type2);
    return WithAction(instaniatedType, options);
  }


  function SpreadElement(type2) {
    const result = IsRest(type2) ? IsTuple(type2.items) ? RestSpread(type2.items.items) : IsInfer(type2.items) ? [type2] : IsRef(type2.items) ? [type2] : [Never()] : [type2];
    return result;
  }
  function RestSpread(types2) {
    const result = types2.reduce((result2, left) => {
      return [...result2, ...SpreadElement(left)];
    }, []);
    return result;
  }


  function State(callstack, visited2) {
    return { callstack, visited: visited2 };
  }
  function CanInstantiate(types2) {
    return guard_exports.ShiftLeft(types2, (left, right) => IsRef(left) ? false : CanInstantiate(right), () => true);
  }
  function InstantiateProperties(context, state2, properties) {
    return guard_exports.Keys(properties).reduce((result, key) => {
      return { ...result, [key]: InstantiateType(context, state2, properties[key]) };
    }, {});
  }
  function InstantiateElements(context, state2, types2) {
    const elements = InstantiateTypes(context, state2, types2);
    const result = RestSpread(elements);
    return result;
  }
  function InstantiateTypes(context, state2, types2) {
    return types2.map((type2) => InstantiateType(context, state2, type2));
  }
  function WithModifiers(type2, instantiatedType) {
    const withOptional = IsOptional(type2) ? AddOptionalAction(instantiatedType, {}) : instantiatedType;
    const withReadonly = IsReadonly(type2) ? AddReadonlyAction(withOptional, {}) : withOptional;
    const withImmutable = IsImmutable(type2) ? AddImmutableAction(withReadonly, {}) : withReadonly;
    return withImmutable;
  }
  function InstantiateDeferred(context, state2, action, parameters, options) {
    return (
      // Modifiers
      guard_exports.IsEqual(action, "AddImmutable") ? AddImmutableInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "RemoveImmutable") ? RemoveImmutableInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "AddReadonly") ? AddReadonlyInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "RemoveReadonly") ? RemoveReadonlyInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "AddOptional") ? AddOptionalInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "RemoveOptional") ? RemoveOptionalInstantiate(context, state2, parameters[0], options) : (
        // Actions
        guard_exports.IsEqual(action, "Capitalize") ? CapitalizeInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Conditional") ? ConditionalInstantiate(context, state2, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "ConstructorParameters") ? ConstructorParametersInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Evaluate") ? EvaluateInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Exclude") ? ExcludeInstantiate(context, state2, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Extract") ? ExtractInstantiate(context, state2, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Index") ? IndexInstantiate(context, state2, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "InstanceType") ? InstanceTypeInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Interface") ? InterfaceInstantiate(context, state2, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "KeyOf") ? KeyOfInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Lowercase") ? LowercaseInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Mapped") ? MappedInstantiate(context, state2, parameters[0], parameters[1], parameters[2], parameters[3], options) : guard_exports.IsEqual(action, "Module") ? ModuleInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "NonNullable") ? NonNullableInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Pick") ? PickInstantiate(context, state2, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Parameters") ? ParametersInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Partial") ? PartialInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Omit") ? OmitInstantiate(context, state2, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "ReadonlyObject") ? ReadonlyObjectInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Record") ? RecordInstantiate(context, state2, parameters[0], parameters[1], options) : guard_exports.IsEqual(action, "Required") ? RequiredInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "ReturnType") ? ReturnTypeInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "TemplateLiteral") ? TemplateLiteralInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Uncapitalize") ? UncapitalizeInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "Uppercase") ? UppercaseInstantiate(context, state2, parameters[0], options) : guard_exports.IsEqual(action, "With") ? WithInstantiate(context, state2, parameters[0], parameters[1]) : Deferred(action, parameters, options)
      )
    );
  }
  function InstantiateImmediate(context, state2, type2) {
    const instantiatedType = IsRef(type2) ? RefInstantiate(context, state2, type2, type2.$ref) : IsArray3(type2) ? _Array_(InstantiateType(context, state2, type2.items), ArrayOptions(type2)) : IsCall(type2) ? CallInstantiate(context, state2, type2.target, type2.arguments) : IsConstructor3(type2) ? Constructor(InstantiateTypes(context, state2, type2.parameters), InstantiateType(context, state2, type2.instanceType), ConstructorOptions(type2)) : IsFunction3(type2) ? _Function_(InstantiateTypes(context, state2, type2.parameters), InstantiateType(context, state2, type2.returnType), FunctionOptions(type2)) : IsDependent(type2) ? Dependent(InstantiateType(context, state2, type2.if), InstantiateType(context, state2, type2.then), InstantiateType(context, state2, type2.else), DependentOptions(type2)) : IsIntersect(type2) ? Intersect(InstantiateTypes(context, state2, type2.allOf), IntersectOptions(type2)) : IsObject3(type2) ? _Object_(InstantiateProperties(context, state2, type2.properties), ObjectOptions(type2)) : IsRecord(type2) ? RecordFromPattern(RecordPattern(type2), InstantiateType(context, state2, RecordValue(type2))) : IsRest(type2) ? Rest(InstantiateType(context, state2, type2.items)) : IsTuple(type2) ? Tuple(InstantiateElements(context, state2, type2.items), TupleOptions(type2)) : IsUnion(type2) ? Union(InstantiateTypes(context, state2, type2.anyOf), UnionOptions(type2)) : type2;
    const withModifiers = WithModifiers(type2, instantiatedType);
    return withModifiers;
  }
  function InstantiateType(context, state2, type2) {
    const result = IsDeferred(type2) ? InstantiateDeferred(context, state2, type2.action, type2.parameters, type2.options) : InstantiateImmediate(context, state2, type2);
    return result;
  }
  function Instantiate(context, type2) {
    return InstantiateType(context, State([], []), type2);
  }


  function AddImmutableOperation(type2) {
    return memory_exports.Update(type2, { "~immutable": true }, {});
  }
  function AddImmutableAction(type2, options) {
    const result = memory_exports.Update(AddImmutableOperation(type2), {}, options);
    return result;
  }
  function AddImmutableInstantiate(context, state2, type2, options) {
    const instantiatedType = InstantiateType(context, state2, type2);
    return AddImmutableAction(instantiatedType, options);
  }


  function AddImmutableDeferred(type2, options = {}) {
    return Deferred("AddImmutable", [type2], options);
  }
  function AddImmutable(type2, options = {}) {
    return AddImmutableAction(type2, options);
  }


  function RemoveImmutableDeferred(type2, options = {}) {
    return Deferred("RemoveImmutable", [type2], options);
  }
  function RemoveImmutable(type2, options = {}) {
    return RemoveImmutableAction(type2, options);
  }


  function EvaluateDeferred(type2, options = {}) {
    return Deferred("Evaluate", [type2], options);
  }
  function Evaluate2(type2, options = {}) {
    return EvaluateAction(type2, options);
  }


  function ModuleDeferred(declarations, options = {}) {
    return Deferred("Module", [declarations], options);
  }
  function Module2(declarations, options = {}) {
    return ModuleInstantiate({}, State([], []), declarations, options);
  }


  function Comparer(left, right) {
    const compareResult = Compare(left, right);
    return guard_exports.IsEqual(compareResult, CompareResultRightInside) ? 1 : guard_exports.IsEqual(compareResult, CompareResultDisjoint) ? 1 : 0;
  }
  function Insert(type2, types2, result = []) {
    return guard_exports.ShiftLeft(types2, (left, right) => guard_exports.IsEqual(Comparer(type2, left), 1) ? Insert(type2, right, [...result, left]) : [...result, type2, ...types2], () => [...result, type2]);
  }
  function Sort(types2, result = []) {
    return guard_exports.ShiftLeft(types2, (left, right) => Sort(right, Insert(left, result)), () => result);
  }
  function Priority(types2) {
    const result = Sort(types2);
    return result;
  }


  function IsTemplateLiteralPattern(pattern) {
    const types2 = ParsePatternIntoTypes(pattern);
    const result = guard_exports.IsEqual(types2.length, 0) ? false : true;
    return result;
  }


  function Script2(...args) {
    const [context, input, options] = arguments_exports.Match(args, {
      2: (script, options2) => guard_exports.IsString(script) ? [{}, script, options2] : [script, options2, {}],
      3: (context2, script, options2) => [context2, script, options2],
      1: (script) => [{}, script, {}]
    });
    const result = Script(input);
    const parsed = guard_exports.IsArray(result) && guard_exports.IsEqual(result.length, 2) ? InstantiateType(context, State([], []), result[0]) : Never();
    return memory_exports.Update(parsed, {}, options);
  }


  var typebox_exports = {};
  __export(typebox_exports, {
    Any: () => Any,
    Array: () => _Array_,
    BigInt: () => BigInt2,
    Boolean: () => Boolean2,
    Call: () => Call2,
    Capitalize: () => Capitalize,
    Codec: () => Codec,
    Conditional: () => Conditional,
    Constructor: () => Constructor,
    ConstructorParameters: () => ConstructorParameters,
    Cyclic: () => Cyclic,
    Decode: () => Decode,
    DecodeBuilder: () => DecodeBuilder,
    Dependent: () => Dependent,
    Encode: () => Encode,
    EncodeBuilder: () => EncodeBuilder,
    Enum: () => Enum,
    Evaluate: () => Evaluate2,
    Exclude: () => Exclude,
    Extends: () => Extends,
    ExtendsResult: () => result_exports,
    Extract: () => Extract,
    Function: () => _Function_,
    Generic: () => Generic,
    Identifier: () => Identifier,
    Immutable: () => Immutable,
    Index: () => Index,
    Infer: () => Infer,
    InstanceType: () => InstanceType,
    Instantiate: () => Instantiate,
    Integer: () => Integer,
    Interface: () => Interface,
    Intersect: () => Intersect,
    IsAny: () => IsAny,
    IsArray: () => IsArray3,
    IsBigInt: () => IsBigInt3,
    IsBoolean: () => IsBoolean4,
    IsCall: () => IsCall,
    IsCodec: () => IsCodec,
    IsConstructor: () => IsConstructor3,
    IsCyclic: () => IsCyclic,
    IsDependent: () => IsDependent,
    IsEnum: () => IsEnum,
    IsEnumValue: () => IsEnumValue,
    IsFunction: () => IsFunction3,
    IsGeneric: () => IsGeneric,
    IsIdentifier: () => IsIdentifier2,
    IsImmutable: () => IsImmutable,
    IsInfer: () => IsInfer,
    IsInteger: () => IsInteger3,
    IsIntersect: () => IsIntersect,
    IsKind: () => IsKind,
    IsLiteral: () => IsLiteral,
    IsNever: () => IsNever,
    IsNull: () => IsNull3,
    IsNumber: () => IsNumber4,
    IsObject: () => IsObject3,
    IsOptional: () => IsOptional,
    IsParameter: () => IsParameter,
    IsReadonly: () => IsReadonly,
    IsRecord: () => IsRecord,
    IsRef: () => IsRef,
    IsRefine: () => IsRefine,
    IsRest: () => IsRest,
    IsSchema: () => IsSchema,
    IsString: () => IsString4,
    IsSymbol: () => IsSymbol3,
    IsTemplateLiteral: () => IsTemplateLiteral,
    IsThis: () => IsThis,
    IsTuple: () => IsTuple,
    IsUndefined: () => IsUndefined3,
    IsUnion: () => IsUnion,
    IsUnknown: () => IsUnknown,
    IsUnsafe: () => IsUnsafe,
    IsVoid: () => IsVoid,
    KeyOf: () => KeyOf2,
    Literal: () => Literal,
    Lowercase: () => Lowercase,
    Mapped: () => Mapped,
    Module: () => Module2,
    Never: () => Never,
    NonNullable: () => NonNullable,
    Null: () => Null,
    Number: () => Number2,
    Object: () => _Object_,
    Omit: () => Omit,
    Optional: () => Optional,
    Parameter: () => Parameter,
    Parameters: () => Parameters,
    Partial: () => Partial,
    Pick: () => Pick,
    Readonly: () => Readonly,
    ReadonlyObject: () => ReadonlyObject,
    ReadonlyType: () => ReadonlyType,
    Record: () => Record,
    RecordKey: () => RecordKey,
    RecordPattern: () => RecordPattern,
    RecordValue: () => RecordValue,
    Ref: () => Ref,
    Refine: () => Refine,
    Required: () => Required,
    Rest: () => Rest,
    ReturnType: () => ReturnType,
    Script: () => Script2,
    String: () => String2,
    Symbol: () => Symbol2,
    TemplateLiteral: () => TemplateLiteral2,
    This: () => This,
    Tuple: () => Tuple,
    Uncapitalize: () => Uncapitalize,
    Undefined: () => Undefined,
    Union: () => Union,
    Unknown: () => Unknown,
    Unsafe: () => Unsafe,
    Uppercase: () => Uppercase,
    Void: () => Void,
    With: () => With2
  });


  var build_default = typebox_exports;


  var pi_tui_exports = {};
  __export(pi_tui_exports, {
    Box: () => Box,
    CURSOR_MARKER: () => CURSOR_MARKER,
    Container: () => Container,
    Key: () => Key,
    SelectList: () => SelectList,
    Text: () => Text,
    applyBackgroundToLine: () => applyBackgroundToLine,
    flattenLines: () => flattenLines,
    fuzzyFilter: () => fuzzyFilter,
    isKeyRelease: () => isKeyRelease,
    matchesKey: () => matchesKey,
    parseKey: () => parseKey,
    renderFakeCursor: () => renderFakeCursor,
    stripTerminalSequences: () => stripTerminalSequences,
    truncateToWidth: () => truncateToWidth,
    visibleWidth: () => visibleWidth,
    wrapTextWithAnsi: () => wrapTextWithAnsi
  });


  var ambiguousMinimalCodePoint = 161;
  var ambiguousMaximumCodePoint = 1114109;
  var ambiguousRanges = [161, 161, 164, 164, 167, 168, 170, 170, 173, 174, 176, 180, 182, 186, 188, 191, 198, 198, 208, 208, 215, 216, 222, 225, 230, 230, 232, 234, 236, 237, 240, 240, 242, 243, 247, 250, 252, 252, 254, 254, 257, 257, 273, 273, 275, 275, 283, 283, 294, 295, 299, 299, 305, 307, 312, 312, 319, 322, 324, 324, 328, 331, 333, 333, 338, 339, 358, 359, 363, 363, 462, 462, 464, 464, 466, 466, 468, 468, 470, 470, 472, 472, 474, 474, 476, 476, 593, 593, 609, 609, 708, 708, 711, 711, 713, 715, 717, 717, 720, 720, 728, 731, 733, 733, 735, 735, 768, 879, 913, 929, 931, 937, 945, 961, 963, 969, 1025, 1025, 1040, 1103, 1105, 1105, 8208, 8208, 8211, 8214, 8216, 8217, 8220, 8221, 8224, 8226, 8228, 8231, 8240, 8240, 8242, 8243, 8245, 8245, 8251, 8251, 8254, 8254, 8308, 8308, 8319, 8319, 8321, 8324, 8364, 8364, 8451, 8451, 8453, 8453, 8457, 8457, 8467, 8467, 8470, 8470, 8481, 8482, 8486, 8486, 8491, 8491, 8531, 8532, 8539, 8542, 8544, 8555, 8560, 8569, 8585, 8585, 8592, 8601, 8632, 8633, 8658, 8658, 8660, 8660, 8679, 8679, 8704, 8704, 8706, 8707, 8711, 8712, 8715, 8715, 8719, 8719, 8721, 8721, 8725, 8725, 8730, 8730, 8733, 8736, 8739, 8739, 8741, 8741, 8743, 8748, 8750, 8750, 8756, 8759, 8764, 8765, 8776, 8776, 8780, 8780, 8786, 8786, 8800, 8801, 8804, 8807, 8810, 8811, 8814, 8815, 8834, 8835, 8838, 8839, 8853, 8853, 8857, 8857, 8869, 8869, 8895, 8895, 8978, 8978, 9312, 9449, 9451, 9547, 9552, 9587, 9600, 9615, 9618, 9621, 9632, 9633, 9635, 9641, 9650, 9651, 9654, 9655, 9660, 9661, 9664, 9665, 9670, 9672, 9675, 9675, 9678, 9681, 9698, 9701, 9711, 9711, 9733, 9734, 9737, 9737, 9742, 9743, 9756, 9756, 9758, 9758, 9792, 9792, 9794, 9794, 9824, 9825, 9827, 9829, 9831, 9834, 9836, 9837, 9839, 9839, 9886, 9887, 9919, 9919, 9926, 9933, 9935, 9939, 9941, 9953, 9955, 9955, 9960, 9961, 9963, 9969, 9972, 9972, 9974, 9977, 9979, 9980, 9982, 9983, 10045, 10045, 10102, 10111, 11094, 11097, 12872, 12879, 57344, 63743, 65024, 65039, 65533, 65533, 127232, 127242, 127248, 127277, 127280, 127337, 127344, 127373, 127375, 127376, 127387, 127404, 917760, 917999, 983040, 1048573, 1048576, 1114109];
  var fullwidthMinimalCodePoint = 12288;
  var fullwidthMaximumCodePoint = 65510;
  var fullwidthRanges = [12288, 12288, 65281, 65376, 65504, 65510];
  var wideMinimalCodePoint = 4352;
  var wideMaximumCodePoint = 262141;
  var wideRanges = [4352, 4447, 8986, 8987, 9001, 9002, 9193, 9196, 9200, 9200, 9203, 9203, 9725, 9726, 9748, 9749, 9776, 9783, 9800, 9811, 9855, 9855, 9866, 9871, 9875, 9875, 9889, 9889, 9898, 9899, 9917, 9918, 9924, 9925, 9934, 9934, 9940, 9940, 9962, 9962, 9970, 9971, 9973, 9973, 9978, 9978, 9981, 9981, 9989, 9989, 9994, 9995, 10024, 10024, 10060, 10060, 10062, 10062, 10067, 10069, 10071, 10071, 10133, 10135, 10160, 10160, 10175, 10175, 11035, 11036, 11088, 11088, 11093, 11093, 11904, 11929, 11931, 12019, 12032, 12245, 12272, 12287, 12289, 12350, 12353, 12438, 12441, 12543, 12549, 12591, 12593, 12686, 12688, 12773, 12783, 12830, 12832, 12871, 12880, 42124, 42128, 42182, 43360, 43388, 44032, 55203, 63744, 64255, 65040, 65049, 65072, 65106, 65108, 65126, 65128, 65131, 94176, 94180, 94192, 94198, 94208, 101589, 101631, 101662, 101760, 101874, 110576, 110579, 110581, 110587, 110589, 110590, 110592, 110882, 110898, 110898, 110928, 110930, 110933, 110933, 110948, 110951, 110960, 111355, 119552, 119638, 119648, 119670, 126980, 126980, 127183, 127183, 127374, 127374, 127377, 127386, 127488, 127490, 127504, 127547, 127552, 127560, 127568, 127569, 127584, 127589, 127744, 127776, 127789, 127797, 127799, 127868, 127870, 127891, 127904, 127946, 127951, 127955, 127968, 127984, 127988, 127988, 127992, 128062, 128064, 128064, 128066, 128252, 128255, 128317, 128331, 128334, 128336, 128359, 128378, 128378, 128405, 128406, 128420, 128420, 128507, 128591, 128640, 128709, 128716, 128716, 128720, 128722, 128725, 128728, 128732, 128735, 128747, 128748, 128756, 128764, 128992, 129003, 129008, 129008, 129292, 129338, 129340, 129349, 129351, 129535, 129648, 129660, 129664, 129674, 129678, 129734, 129736, 129736, 129741, 129756, 129759, 129770, 129775, 129784, 131072, 196605, 196608, 262141];


  var isInRange = (ranges, codePoint) => {
    let low = 0;
    let high = Math.floor(ranges.length / 2) - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const i = mid * 2;
      if (codePoint < ranges[i]) {
        high = mid - 1;
      } else if (codePoint > ranges[i + 1]) {
        low = mid + 1;
      } else {
        return true;
      }
    }
    return false;
  };


  var commonCjkCodePoint = 19968;
  var [wideFastPathStart, wideFastPathEnd] = /* @__PURE__ */ findWideFastPathRange(wideRanges);
  function findWideFastPathRange(ranges) {
    let fastPathStart = ranges[0];
    let fastPathEnd = ranges[1];
    for (let index3 = 0; index3 < ranges.length; index3 += 2) {
      const start2 = ranges[index3];
      const end = ranges[index3 + 1];
      if (commonCjkCodePoint >= start2 && commonCjkCodePoint <= end) {
        return [start2, end];
      }
      if (end - start2 > fastPathEnd - fastPathStart) {
        fastPathStart = start2;
        fastPathEnd = end;
      }
    }
    return [fastPathStart, fastPathEnd];
  }
  var isAmbiguous = (codePoint) => {
    if (codePoint < ambiguousMinimalCodePoint || codePoint > ambiguousMaximumCodePoint) {
      return false;
    }
    return isInRange(ambiguousRanges, codePoint);
  };
  var isFullWidth = (codePoint) => {
    if (codePoint < fullwidthMinimalCodePoint || codePoint > fullwidthMaximumCodePoint) {
      return false;
    }
    return isInRange(fullwidthRanges, codePoint);
  };
  var isWide = (codePoint) => {
    if (codePoint >= wideFastPathStart && codePoint <= wideFastPathEnd) {
      return true;
    }
    if (codePoint < wideMinimalCodePoint || codePoint > wideMaximumCodePoint) {
      return false;
    }
    return isInRange(wideRanges, codePoint);
  };


  function validate(codePoint) {
    if (!Number.isSafeInteger(codePoint)) {
      throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
    }
  }
  function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
    validate(codePoint);
    if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
      return 2;
    }
    return 1;
  }


  var graphemeSegmenter = new Intl.Segmenter(void 0, { granularity: "grapheme" });
  var wordSegmenter = new Intl.Segmenter(void 0, { granularity: "word" });
  function couldBeEmoji(segment) {
    const cp = segment.codePointAt(0);
    return cp >= 126976 && cp <= 130047 || // Emoji and Pictograph
    cp >= 8960 && cp <= 9215 || // Misc technical
    cp >= 9728 && cp <= 10175 || // Misc symbols, dingbats
    cp >= 11088 && cp <= 11093 || // Specific stars/circles
    segment.includes("\uFE0F") || // Contains VS16 (emoji presentation selector)
    segment.length > 2;
  }
  var zeroWidthRegex = new RegExp("^(?:\\p{Default_Ignorable_Code_Point}|\\p{Control}|\\p{Mark}|\\p{Surrogate})+$", "v");
  var leadingNonPrintingRegex = new RegExp("^[\\p{Default_Ignorable_Code_Point}\\p{Control}\\p{Format}\\p{Mark}\\p{Surrogate}]+", "v");
  var nonPrintingCharRegex = new RegExp("^(?:\\p{Default_Ignorable_Code_Point}|\\p{Control}|\\p{Format}|\\p{Mark}|\\p{Surrogate})$", "v");
  var markCharRegex = new RegExp("^\\p{Mark}$", "v");
  var terminalSpacingMarkRegex = new RegExp("^(?:[\\p{Spacing_Mark}--[\\u1734\\u302E\\u302F]]|[\\u065F\\u0F7F\\u102B\\u102C\\u1031\\u1033-\\u1035\\u1038\\u103A-\\u103E])+$", "v");
  var rgiEmojiRegex = new RegExp("^\\p{RGI_Emoji}$", "v");
  var WIDTH_CACHE_SIZE = 512;
  var widthCache = /* @__PURE__ */ new Map();
  var cjkBreakRegex = /[\p{Script_Extensions=Han}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\p{Script_Extensions=Hangul}\p{Script_Extensions=Bopomofo}]/u;
  var cjkPunctuationRegex = new RegExp(
    `(?:(?=\\p{Punctuation})${cjkBreakRegex.source}|[\uFF0C\uFF0E\uFF1A\uFF1B\uFF01\uFF1F\uFF08\uFF09\uFF3B\uFF3D\uFF5B\uFF5D\u201C\u201D\u2018\u2019\u2026\u2014])`,
    "u"
  );
  var autocompleteSeparatorRegex = new RegExp(`(?:\\s|${cjkPunctuationRegex.source})`, "u");
  var autocompleteBoundaryRegex = new RegExp(`(?:^|${autocompleteSeparatorRegex.source})`, "u");
  function isPrintableAscii(str) {
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 32 || code > 126) {
        return false;
      }
    }
    return true;
  }
  function truncateFragmentToWidth(text, maxWidth) {
    if (maxWidth <= 0 || text.length === 0) {
      return { text: "", width: 0 };
    }
    if (isPrintableAscii(text)) {
      const clipped = text.slice(0, maxWidth);
      return { text: clipped, width: clipped.length };
    }
    const hasAnsi = text.includes("\x1B");
    const hasTabs = text.includes("	");
    if (!hasAnsi && !hasTabs) {
      let result2 = "";
      let width2 = 0;
      for (const { segment } of graphemeSegmenter.segment(text)) {
        const w = graphemeWidth(segment);
        if (width2 + w > maxWidth) {
          break;
        }
        result2 += segment;
        width2 += w;
      }
      return { text: result2, width: width2 };
    }
    let result = "";
    let width = 0;
    let i = 0;
    let pendingAnsi = "";
    while (i < text.length) {
      const ansi = extractAnsiCode(text, i);
      if (ansi) {
        pendingAnsi += ansi.code;
        i += ansi.length;
        continue;
      }
      if (text[i] === "	") {
        if (width + 3 > maxWidth) {
          break;
        }
        if (pendingAnsi) {
          result += pendingAnsi;
          pendingAnsi = "";
        }
        result += "	";
        width += 3;
        i++;
        continue;
      }
      let end = i;
      while (end < text.length && text[end] !== "	") {
        const nextAnsi = extractAnsiCode(text, end);
        if (nextAnsi) {
          break;
        }
        end++;
      }
      for (const { segment } of graphemeSegmenter.segment(text.slice(i, end))) {
        const w = graphemeWidth(segment);
        if (width + w > maxWidth) {
          return { text: result, width };
        }
        if (pendingAnsi) {
          result += pendingAnsi;
          pendingAnsi = "";
        }
        result += segment;
        width += w;
      }
      i = end;
    }
    return { text: result, width };
  }
  function finalizeTruncatedResult(prefix, prefixWidth, ellipsis, ellipsisWidth, maxWidth, pad) {
    const reset = "\x1B[0m";
    const hyperlinkClose = getActiveOsc8Close(prefix);
    const visibleWidth2 = prefixWidth + ellipsisWidth;
    let result;
    if (ellipsis.length > 0) {
      result = `${prefix}${hyperlinkClose}${reset}${ellipsis}${reset}`;
    } else {
      result = `${prefix}${hyperlinkClose}${reset}`;
    }
    return pad ? result + " ".repeat(Math.max(0, maxWidth - visibleWidth2)) : result;
  }
  function graphemeWidth(segment) {
    if (segment.length === 1) {
      const code = segment.charCodeAt(0);
      if (code >= 32 && code <= 126) return 1;
      if (code === 9) return 3;
    }
    if (terminalSpacingMarkRegex.test(segment)) {
      return [...segment].length;
    }
    if (zeroWidthRegex.test(segment)) {
      return 0;
    }
    if (couldBeEmoji(segment) && rgiEmojiRegex.test(segment)) {
      return 2;
    }
    const base = segment.replace(leadingNonPrintingRegex, "");
    const cp = base.codePointAt(0);
    if (cp === void 0) {
      return 0;
    }
    if (cp >= 127462 && cp <= 127487) {
      return 2;
    }
    let width = eastAsianWidth(cp);
    let followsMark = false;
    const chars = [...base];
    for (const char of chars.slice(1)) {
      if (terminalSpacingMarkRegex.test(char)) {
        width += 1;
        followsMark = false;
      } else if (markCharRegex.test(char)) {
        followsMark = true;
      } else if (!nonPrintingCharRegex.test(char)) {
        const c = char.codePointAt(0);
        if (followsMark || c >= 65280 && c <= 65519) {
          width += eastAsianWidth(c);
        } else if (c === 3635 || c === 3763) {
          width += 1;
        }
        followsMark = false;
      }
    }
    return width;
  }
  function visibleWidth(str) {
    if (str.length === 0) {
      return 0;
    }
    const asciiWidth = asciiVisibleWidth(str);
    if (asciiWidth !== -1) {
      return asciiWidth;
    }
    const cached = widthCache.get(str);
    if (cached !== void 0) {
      return cached;
    }
    let clean = str;
    if (str.includes("	")) {
      clean = clean.replace(/\t/g, "   ");
    }
    let escapeIndex = clean.indexOf("\x1B");
    if (escapeIndex !== -1) {
      let stripped = "";
      let copyFrom = 0;
      while (escapeIndex !== -1) {
        const length = ansiCodeLength(clean, escapeIndex);
        if (length > 0) {
          stripped += clean.slice(copyFrom, escapeIndex);
          escapeIndex += length;
          copyFrom = escapeIndex;
        } else {
          escapeIndex++;
        }
        escapeIndex = clean.indexOf("\x1B", escapeIndex);
      }
      clean = stripped + clean.slice(copyFrom);
    }
    let width = 0;
    for (const { segment } of graphemeSegmenter.segment(clean)) {
      width += graphemeWidth(segment);
    }
    if (widthCache.size >= WIDTH_CACHE_SIZE) {
      const firstKey = widthCache.keys().next().value;
      if (firstKey !== void 0) {
        widthCache.delete(firstKey);
      }
    }
    widthCache.set(str, width);
    return width;
  }
  function stripTerminalSequences(str) {
    if (!str.includes("\x1B")) return str;
    let result = "";
    let i = 0;
    while (i < str.length) {
      const ansi = extractAnsiCode(str, i);
      if (ansi) {
        i += ansi.length;
        continue;
      }
      result += str[i];
      i++;
    }
    return result;
  }
  function extractAnsiCode(str, pos) {
    const length = ansiCodeLength(str, pos);
    return length > 0 ? { code: str.substring(pos, pos + length), length } : null;
  }
  function asciiVisibleWidth(str) {
    let width = 0;
    let i = 0;
    while (i < str.length) {
      const code = str.charCodeAt(i);
      if (code >= 32 && code <= 126) {
        width++;
        i++;
      } else if (code === 9) {
        width += 3;
        i++;
      } else if (code === 27) {
        const length = ansiCodeLength(str, i);
        if (length === 0) return -1;
        i += length;
      } else {
        return -1;
      }
    }
    return width;
  }
  function ansiCodeLength(str, pos) {
    if (pos >= str.length || str.charCodeAt(pos) !== 27) return 0;
    const next = str[pos + 1];
    if (next === "[") {
      for (let j = pos + 2; j < str.length; j++) {
        const c = str.charCodeAt(j);
        if (c === 109 || c === 71 || c === 75 || c === 72 || c === 74) return j + 1 - pos;
      }
      return 0;
    }
    if (next === "]" || next === "_") {
      for (let j = pos + 2; j < str.length; j++) {
        const c = str.charCodeAt(j);
        if (c === 7) return j + 1 - pos;
        if (c === 27 && str[j + 1] === "\\") return j + 2 - pos;
      }
      return 0;
    }
    return 0;
  }
  function parseOsc8Hyperlink(ansiCode) {
    if (!ansiCode.startsWith("\x1B]8;")) {
      return void 0;
    }
    const terminator = ansiCode.endsWith("\x07") ? "\x07" : "\x1B\\";
    const body = ansiCode.slice(4, terminator === "\x07" ? -1 : -2);
    const separatorIndex = body.indexOf(";");
    if (separatorIndex === -1) {
      return void 0;
    }
    const params = body.slice(0, separatorIndex);
    const url = body.slice(separatorIndex + 1);
    if (!url) {
      return null;
    }
    return { params, url, terminator };
  }
  function formatOsc8Hyperlink(hyperlink) {
    return `\x1B]8;${hyperlink.params};${hyperlink.url}${hyperlink.terminator}`;
  }
  function formatOsc8Close(terminator) {
    return `\x1B]8;;${terminator}`;
  }
  function getActiveOsc8Close(prefix) {
    if (!prefix.includes("\x1B]8;")) {
      return "";
    }
    let activeHyperlink = null;
    let i = 0;
    while (i < prefix.length) {
      const ansi = extractAnsiCode(prefix, i);
      if (ansi) {
        const hyperlink = parseOsc8Hyperlink(ansi.code);
        if (hyperlink !== void 0) {
          activeHyperlink = hyperlink;
        }
        i += ansi.length;
      } else {
        i++;
      }
    }
    return activeHyperlink ? formatOsc8Close(activeHyperlink.terminator) : "";
  }
  var AnsiCodeTracker = class {
    // Track individual attributes separately so we can reset them specifically
    bold = false;
    dim = false;
    italic = false;
    underline = false;
    blink = false;
    inverse = false;
    hidden = false;
    strikethrough = false;
    fgColor = null;
    // Stores the full code like "31" or "38;5;240"
    bgColor = null;
    // Stores the full code like "41" or "48;5;240"
    activeHyperlink = null;
    process(ansiCode) {
      const hyperlink = parseOsc8Hyperlink(ansiCode);
      if (hyperlink !== void 0) {
        this.activeHyperlink = hyperlink;
        return;
      }
      if (!ansiCode.endsWith("m")) {
        return;
      }
      const match2 = ansiCode.match(/\x1b\[([\d;]*)m/);
      if (!match2) return;
      const params = match2[1];
      if (params === "" || params === "0") {
        this.reset();
        return;
      }
      const parts = params.split(";");
      let i = 0;
      while (i < parts.length) {
        const code = Number.parseInt(parts[i], 10);
        if (code === 38 || code === 48) {
          if (parts[i + 1] === "5" && parts[i + 2] !== void 0) {
            const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]}`;
            if (code === 38) {
              this.fgColor = colorCode;
            } else {
              this.bgColor = colorCode;
            }
            i += 3;
            continue;
          } else if (parts[i + 1] === "2" && parts[i + 4] !== void 0) {
            const colorCode = `${parts[i]};${parts[i + 1]};${parts[i + 2]};${parts[i + 3]};${parts[i + 4]}`;
            if (code === 38) {
              this.fgColor = colorCode;
            } else {
              this.bgColor = colorCode;
            }
            i += 5;
            continue;
          }
        }
        switch (code) {
          case 0:
            this.reset();
            break;
          case 1:
            this.bold = true;
            break;
          case 2:
            this.dim = true;
            break;
          case 3:
            this.italic = true;
            break;
          case 4:
            this.underline = true;
            break;
          case 5:
            this.blink = true;
            break;
          case 7:
            this.inverse = true;
            break;
          case 8:
            this.hidden = true;
            break;
          case 9:
            this.strikethrough = true;
            break;
          case 21:
            this.bold = false;
            break;
          // Some terminals
          case 22:
            this.bold = false;
            this.dim = false;
            break;
          case 23:
            this.italic = false;
            break;
          case 24:
            this.underline = false;
            break;
          case 25:
            this.blink = false;
            break;
          case 27:
            this.inverse = false;
            break;
          case 28:
            this.hidden = false;
            break;
          case 29:
            this.strikethrough = false;
            break;
          case 39:
            this.fgColor = null;
            break;
          // Default fg
          case 49:
            this.bgColor = null;
            break;
          // Default bg
          default:
            if (code >= 30 && code <= 37 || code >= 90 && code <= 97) {
              this.fgColor = String(code);
            } else if (code >= 40 && code <= 47 || code >= 100 && code <= 107) {
              this.bgColor = String(code);
            }
            break;
        }
        i++;
      }
    }
    reset() {
      this.bold = false;
      this.dim = false;
      this.italic = false;
      this.underline = false;
      this.blink = false;
      this.inverse = false;
      this.hidden = false;
      this.strikethrough = false;
      this.fgColor = null;
      this.bgColor = null;
    }
    /** Clear all state for reuse. */
    clear() {
      this.reset();
      this.activeHyperlink = null;
    }
    getActiveCodes() {
      const codes = [];
      if (this.bold) codes.push("1");
      if (this.dim) codes.push("2");
      if (this.italic) codes.push("3");
      if (this.underline) codes.push("4");
      if (this.blink) codes.push("5");
      if (this.inverse) codes.push("7");
      if (this.hidden) codes.push("8");
      if (this.strikethrough) codes.push("9");
      if (this.fgColor) codes.push(this.fgColor);
      if (this.bgColor) codes.push(this.bgColor);
      let result = codes.length > 0 ? `\x1B[${codes.join(";")}m` : "";
      if (this.activeHyperlink) {
        result += formatOsc8Hyperlink(this.activeHyperlink);
      }
      return result;
    }
    getActiveBackgroundCode() {
      return this.bgColor ? `\x1B[${this.bgColor}m` : "";
    }
    hasActiveCodes() {
      return this.bold || this.dim || this.italic || this.underline || this.blink || this.inverse || this.hidden || this.strikethrough || this.fgColor !== null || this.bgColor !== null || this.activeHyperlink !== null;
    }
    /**
     * Get reset codes for attributes that need to be turned off at line end.
     * Underline must be closed to prevent bleeding into padding.
     * Active OSC 8 hyperlinks must be closed and re-opened on the next line.
     * Returns empty string if no attributes need closing.
     */
    getLineEndReset() {
      let result = "";
      if (this.underline) {
        result += "\x1B[24m";
      }
      if (this.activeHyperlink) {
        result += formatOsc8Close(this.activeHyperlink.terminator);
      }
      return result;
    }
  };
  function updateTrackerFromText(text, tracker) {
    let i = text.indexOf("\x1B");
    while (i !== -1) {
      const length = ansiCodeLength(text, i);
      if (length > 0) {
        tracker.process(text.substring(i, i + length));
        i += length;
      } else {
        i++;
      }
      i = text.indexOf("\x1B", i);
    }
  }
  function* graphemeSegments(text) {
    for (const { segment } of graphemeSegmenter.segment(text)) yield segment;
  }
  function splitIntoTokensWithAnsi(text) {
    const tokens = [];
    let current = "";
    let pendingAnsi = "";
    let currentKind = null;
    let i = 0;
    const flushCurrent = () => {
      if (!current) {
        return;
      }
      tokens.push(current);
      current = "";
      currentKind = null;
    };
    while (i < text.length) {
      const ansiResult = extractAnsiCode(text, i);
      if (ansiResult) {
        pendingAnsi += ansiResult.code;
        i += ansiResult.length;
        continue;
      }
      let end = text.indexOf("\x1B", i + 1);
      while (end !== -1 && ansiCodeLength(text, end) === 0) {
        end = text.indexOf("\x1B", end + 1);
      }
      if (end === -1) end = text.length;
      const chunk = text.slice(i, end);
      const ascii = isPrintableAscii(chunk);
      for (const segment of ascii ? chunk : graphemeSegments(chunk)) {
        const segmentIsSpace = segment === " ";
        if (!ascii && !segmentIsSpace && cjkBreakRegex.test(segment)) {
          flushCurrent();
          const token = pendingAnsi + segment;
          pendingAnsi = "";
          tokens.push(token);
          continue;
        }
        const segmentKind = segmentIsSpace ? "space" : "word";
        if (current && currentKind !== segmentKind) {
          flushCurrent();
        }
        if (pendingAnsi) {
          current += pendingAnsi;
          pendingAnsi = "";
        }
        currentKind = segmentKind;
        current += segment;
      }
      i = end;
    }
    if (pendingAnsi) {
      if (current) {
        current += pendingAnsi;
      } else if (tokens.length > 0) {
        tokens[tokens.length - 1] += pendingAnsi;
      } else {
        current = pendingAnsi;
      }
    }
    if (current) {
      tokens.push(current);
    }
    return tokens;
  }
  function flattenLines(lines) {
    for (const line of lines) Number(line);
  }
  function wrapTextWithAnsi(text, width) {
    if (!text) {
      return [""];
    }
    const inputLines = text.split(/\r\n|\r|\n/);
    const result = [];
    const tracker = new AnsiCodeTracker();
    for (const inputLine of inputLines) {
      const prefix = result.length > 0 ? tracker.getActiveCodes() : "";
      const wrappedLines = wrapSingleLine(prefix + inputLine, width);
      for (const wrappedLine of wrappedLines) {
        result.push(wrappedLine);
      }
      updateTrackerFromText(inputLine, tracker);
    }
    return result.length > 0 ? result : [""];
  }
  function wrapSingleLine(line, width) {
    if (!line) {
      return [""];
    }
    const visibleLength = visibleWidth(line);
    if (visibleLength <= width) {
      return [line];
    }
    const wrapped = [];
    const tracker = new AnsiCodeTracker();
    const tokens = splitIntoTokensWithAnsi(line);
    let currentLine = "";
    let currentVisibleLength = 0;
    for (const token of tokens) {
      const tokenVisibleLength = visibleWidth(token);
      const isWhitespace = token.trim() === "";
      if (tokenVisibleLength > width && !isWhitespace) {
        if (currentLine) {
          const lineEndReset = tracker.getLineEndReset();
          if (lineEndReset) {
            currentLine += lineEndReset;
          }
          wrapped.push(currentLine);
          currentLine = "";
          currentVisibleLength = 0;
        }
        const broken = breakLongWord(token, width, tracker);
        for (let i = 0; i < broken.length - 1; i++) {
          wrapped.push(broken[i]);
        }
        currentLine = broken[broken.length - 1];
        currentVisibleLength = visibleWidth(currentLine);
        continue;
      }
      const totalNeeded = currentVisibleLength + tokenVisibleLength;
      if (totalNeeded > width && currentVisibleLength > 0) {
        let lineToWrap = currentLine.trimEnd();
        const lineEndReset = tracker.getLineEndReset();
        if (lineEndReset) {
          lineToWrap += lineEndReset;
        }
        wrapped.push(lineToWrap);
        if (isWhitespace) {
          currentLine = tracker.getActiveCodes();
          currentVisibleLength = 0;
        } else {
          currentLine = tracker.getActiveCodes() + token;
          currentVisibleLength = tokenVisibleLength;
        }
      } else {
        currentLine += token;
        currentVisibleLength += tokenVisibleLength;
      }
      updateTrackerFromText(token, tracker);
    }
    if (currentLine) {
      wrapped.push(currentLine);
    }
    return wrapped.length > 0 ? wrapped.map((line2) => line2.trimEnd()) : [""];
  }
  function breakLongWord(word, width, tracker) {
    const lines = [];
    let currentLine = tracker.getActiveCodes();
    let currentWidth = 0;
    let i = 0;
    const segments = [];
    while (i < word.length) {
      const ansiResult = extractAnsiCode(word, i);
      if (ansiResult) {
        segments.push({ type: "ansi", value: ansiResult.code });
        i += ansiResult.length;
      } else {
        let end = i;
        while (end < word.length) {
          const nextAnsi = extractAnsiCode(word, end);
          if (nextAnsi) break;
          end++;
        }
        const textPortion = word.slice(i, end);
        for (const seg of graphemeSegmenter.segment(textPortion)) {
          segments.push({ type: "grapheme", value: seg.segment });
        }
        i = end;
      }
    }
    for (const seg of segments) {
      if (seg.type === "ansi") {
        currentLine += seg.value;
        tracker.process(seg.value);
        continue;
      }
      const grapheme = seg.value;
      if (!grapheme) continue;
      const graphemeWidth2 = visibleWidth(grapheme);
      if (currentWidth + graphemeWidth2 > width) {
        const lineEndReset = tracker.getLineEndReset();
        if (lineEndReset) {
          currentLine += lineEndReset;
        }
        lines.push(currentLine);
        currentLine = tracker.getActiveCodes();
        currentWidth = 0;
      }
      currentLine += grapheme;
      currentWidth += graphemeWidth2;
    }
    if (currentLine) {
      lines.push(currentLine);
    }
    return lines.length > 0 ? lines : [""];
  }
  function applyBackgroundToLine(line, width, bgFn) {
    const visibleLen = visibleWidth(line);
    const paddingNeeded = Math.max(0, width - visibleLen);
    const padding = " ".repeat(paddingNeeded);
    const withPadding = line + padding;
    return bgFn(withPadding);
  }
  function truncateToWidth(text, maxWidth, ellipsis = "...", pad = false) {
    if (maxWidth <= 0) {
      return "";
    }
    if (text.length === 0) {
      return pad ? " ".repeat(maxWidth) : "";
    }
    const ellipsisWidth = visibleWidth(ellipsis);
    if (ellipsisWidth >= maxWidth) {
      const textWidth = visibleWidth(text);
      if (textWidth <= maxWidth) {
        return pad ? text + " ".repeat(maxWidth - textWidth) : text;
      }
      const clippedEllipsis = truncateFragmentToWidth(ellipsis, maxWidth);
      if (clippedEllipsis.width === 0) {
        return pad ? " ".repeat(maxWidth) : "";
      }
      return finalizeTruncatedResult("", 0, clippedEllipsis.text, clippedEllipsis.width, maxWidth, pad);
    }
    if (isPrintableAscii(text)) {
      if (text.length <= maxWidth) {
        return pad ? text + " ".repeat(maxWidth - text.length) : text;
      }
      const targetWidth2 = maxWidth - ellipsisWidth;
      return finalizeTruncatedResult(text.slice(0, targetWidth2), targetWidth2, ellipsis, ellipsisWidth, maxWidth, pad);
    }
    const targetWidth = maxWidth - ellipsisWidth;
    let result = "";
    let pendingAnsi = "";
    let visibleSoFar = 0;
    let keptWidth = 0;
    let keepContiguousPrefix = true;
    let overflowed = false;
    let exhaustedInput = false;
    const hasAnsi = text.includes("\x1B");
    const hasTabs = text.includes("	");
    if (!hasAnsi && !hasTabs) {
      for (const { segment } of graphemeSegmenter.segment(text)) {
        const width = graphemeWidth(segment);
        if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
          result += segment;
          keptWidth += width;
        } else {
          keepContiguousPrefix = false;
        }
        visibleSoFar += width;
        if (visibleSoFar > maxWidth) {
          overflowed = true;
          break;
        }
      }
      exhaustedInput = !overflowed;
    } else {
      let i = 0;
      while (i < text.length) {
        const ansi = extractAnsiCode(text, i);
        if (ansi) {
          pendingAnsi += ansi.code;
          i += ansi.length;
          continue;
        }
        if (text[i] === "	") {
          if (keepContiguousPrefix && keptWidth + 3 <= targetWidth) {
            if (pendingAnsi) {
              result += pendingAnsi;
              pendingAnsi = "";
            }
            result += "	";
            keptWidth += 3;
          } else {
            keepContiguousPrefix = false;
            pendingAnsi = "";
          }
          visibleSoFar += 3;
          if (visibleSoFar > maxWidth) {
            overflowed = true;
            break;
          }
          i++;
          continue;
        }
        let end = i;
        while (end < text.length && text[end] !== "	") {
          const nextAnsi = extractAnsiCode(text, end);
          if (nextAnsi) {
            break;
          }
          end++;
        }
        for (const { segment } of graphemeSegmenter.segment(text.slice(i, end))) {
          const width = graphemeWidth(segment);
          if (keepContiguousPrefix && keptWidth + width <= targetWidth) {
            if (pendingAnsi) {
              result += pendingAnsi;
              pendingAnsi = "";
            }
            result += segment;
            keptWidth += width;
          } else {
            keepContiguousPrefix = false;
            pendingAnsi = "";
          }
          visibleSoFar += width;
          if (visibleSoFar > maxWidth) {
            overflowed = true;
            break;
          }
        }
        if (overflowed) {
          break;
        }
        i = end;
      }
      exhaustedInput = i >= text.length;
    }
    if (!overflowed && exhaustedInput) {
      return pad ? text + " ".repeat(Math.max(0, maxWidth - visibleSoFar)) : text;
    }
    return finalizeTruncatedResult(result, keptWidth, ellipsis, ellipsisWidth, maxWidth, pad);
  }
  var pooledStyleTracker = new AnsiCodeTracker();


  var Text = class {
    text;
    paddingX;
    // Left/right padding
    paddingY;
    // Top/bottom padding
    customBgFn;
    // Cache for rendered output
    cachedText;
    cachedWidth;
    cachedLines;
    constructor(text = "", paddingX = 1, paddingY = 1, customBgFn) {
      this.text = text;
      this.paddingX = paddingX;
      this.paddingY = paddingY;
      this.customBgFn = customBgFn;
    }
    setText(text) {
      this.text = text;
      this.cachedText = void 0;
      this.cachedWidth = void 0;
      this.cachedLines = void 0;
    }
    setCustomBgFn(customBgFn) {
      this.customBgFn = customBgFn;
      this.cachedText = void 0;
      this.cachedWidth = void 0;
      this.cachedLines = void 0;
    }
    setPaddingX(paddingX) {
      this.paddingX = paddingX;
      this.invalidate();
    }
    invalidate() {
      this.cachedText = void 0;
      this.cachedWidth = void 0;
      this.cachedLines = void 0;
    }
    render(width) {
      if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
        return this.cachedLines;
      }
      if (!this.text || this.text.trim() === "") {
        const result2 = [];
        this.cachedText = this.text;
        this.cachedWidth = width;
        this.cachedLines = result2;
        return result2;
      }
      const normalizedText = this.text.replace(/\t/g, "   ");
      const paddingX = Math.min(this.paddingX, Math.max(0, Math.floor((width - 1) / 2)));
      const contentWidth = Math.max(1, width - paddingX * 2);
      const wrappedLines = wrapTextWithAnsi(normalizedText, contentWidth);
      const leftMargin = " ".repeat(paddingX);
      const rightMargin = " ".repeat(paddingX);
      const contentLines = [];
      for (const line of wrappedLines) {
        const lineWithMargins = leftMargin + line + rightMargin;
        if (this.customBgFn) {
          contentLines.push(applyBackgroundToLine(lineWithMargins, width, this.customBgFn));
        } else {
          const visibleLen = visibleWidth(lineWithMargins);
          const paddingNeeded = Math.max(0, width - visibleLen);
          contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
        }
      }
      const emptyLine = " ".repeat(width);
      const emptyLines = [];
      for (let i = 0; i < this.paddingY; i++) {
        const line = this.customBgFn ? applyBackgroundToLine(emptyLine, width, this.customBgFn) : emptyLine;
        emptyLines.push(line);
      }
      const result = [...emptyLines, ...contentLines, ...emptyLines];
      flattenLines(result);
      this.cachedText = this.text;
      this.cachedWidth = width;
      this.cachedLines = result;
      return result.length > 0 ? result : [""];
    }
  };


  var node_perf_hooks_exports = {};
  __export(node_perf_hooks_exports, {
    default: () => node_perf_hooks_default,
    performance: () => performance
  });
  var performance = globalThis.performance;
  var node_perf_hooks_default = { performance };


  var _kittyProtocolActive = false;
  var Key = {
    // Special keys
    escape: "escape",
    esc: "esc",
    enter: "enter",
    return: "return",
    tab: "tab",
    space: "space",
    backspace: "backspace",
    delete: "delete",
    insert: "insert",
    clear: "clear",
    home: "home",
    end: "end",
    pageUp: "pageUp",
    pageDown: "pageDown",
    up: "up",
    down: "down",
    left: "left",
    right: "right",
    f1: "f1",
    f2: "f2",
    f3: "f3",
    f4: "f4",
    f5: "f5",
    f6: "f6",
    f7: "f7",
    f8: "f8",
    f9: "f9",
    f10: "f10",
    f11: "f11",
    f12: "f12",
    // Symbol keys
    backtick: "`",
    hyphen: "-",
    equals: "=",
    leftbracket: "[",
    rightbracket: "]",
    backslash: "\\",
    semicolon: ";",
    quote: "'",
    comma: ",",
    period: ".",
    slash: "/",
    exclamation: "!",
    at: "@",
    hash: "#",
    dollar: "$",
    percent: "%",
    caret: "^",
    ampersand: "&",
    asterisk: "*",
    leftparen: "(",
    rightparen: ")",
    underscore: "_",
    plus: "+",
    pipe: "|",
    tilde: "~",
    leftbrace: "{",
    rightbrace: "}",
    colon: ":",
    lessthan: "<",
    greaterthan: ">",
    question: "?",
    // Single modifiers
    ctrl: (key) => `ctrl+${key}`,
    shift: (key) => `shift+${key}`,
    alt: (key) => `alt+${key}`,
    super: (key) => `super+${key}`,
    // Combined modifiers
    ctrlShift: (key) => `ctrl+shift+${key}`,
    shiftCtrl: (key) => `shift+ctrl+${key}`,
    ctrlAlt: (key) => `ctrl+alt+${key}`,
    altCtrl: (key) => `alt+ctrl+${key}`,
    shiftAlt: (key) => `shift+alt+${key}`,
    altShift: (key) => `alt+shift+${key}`,
    ctrlSuper: (key) => `ctrl+super+${key}`,
    superCtrl: (key) => `super+ctrl+${key}`,
    shiftSuper: (key) => `shift+super+${key}`,
    superShift: (key) => `super+shift+${key}`,
    altSuper: (key) => `alt+super+${key}`,
    superAlt: (key) => `super+alt+${key}`,
    // Triple modifiers
    ctrlShiftAlt: (key) => `ctrl+shift+alt+${key}`,
    ctrlShiftSuper: (key) => `ctrl+shift+super+${key}`
  };
  var SYMBOL_KEYS = /* @__PURE__ */ new Set([
    "`",
    "-",
    "=",
    "[",
    "]",
    "\\",
    ";",
    "'",
    ",",
    ".",
    "/",
    "!",
    "@",
    "#",
    "$",
    "%",
    "^",
    "&",
    "*",
    "(",
    ")",
    "_",
    "+",
    "|",
    "~",
    "{",
    "}",
    ":",
    "<",
    ">",
    "?"
  ]);
  var SHIFTED_SYMBOL_KEYS = new Set("~!@#$%^&*()_+|{}:<>?");
  var MODIFIER_NAMES = ["shift", "alt", "ctrl", "super"];
  var MODIFIERS = {
    shift: 1,
    alt: 2,
    ctrl: 4,
    super: 8
  };
  var LOCK_MASK = 64 + 128;
  var CODEPOINTS = {
    escape: 27,
    tab: 9,
    enter: 13,
    space: 32,
    backspace: 127,
    kpEnter: 57414
    // Numpad Enter (Kitty protocol)
  };
  var ARROW_CODEPOINTS = {
    up: -1,
    down: -2,
    right: -3,
    left: -4
  };
  var FUNCTIONAL_CODEPOINTS = {
    delete: -10,
    insert: -11,
    pageUp: -12,
    pageDown: -13,
    home: -14,
    end: -15
  };
  var KITTY_FUNCTIONAL_KEY_EQUIVALENTS = /* @__PURE__ */ new Map([
    [57399, 48],
    // KP_0 -> 0
    [57400, 49],
    // KP_1 -> 1
    [57401, 50],
    // KP_2 -> 2
    [57402, 51],
    // KP_3 -> 3
    [57403, 52],
    // KP_4 -> 4
    [57404, 53],
    // KP_5 -> 5
    [57405, 54],
    // KP_6 -> 6
    [57406, 55],
    // KP_7 -> 7
    [57407, 56],
    // KP_8 -> 8
    [57408, 57],
    // KP_9 -> 9
    [57409, 46],
    // KP_DECIMAL -> .
    [57410, 47],
    // KP_DIVIDE -> /
    [57411, 42],
    // KP_MULTIPLY -> *
    [57412, 45],
    // KP_SUBTRACT -> -
    [57413, 43],
    // KP_ADD -> +
    [57415, 61],
    // KP_EQUAL -> =
    [57416, 44],
    // KP_SEPARATOR -> ,
    [57417, ARROW_CODEPOINTS.left],
    [57418, ARROW_CODEPOINTS.right],
    [57419, ARROW_CODEPOINTS.up],
    [57420, ARROW_CODEPOINTS.down],
    [57421, FUNCTIONAL_CODEPOINTS.pageUp],
    [57422, FUNCTIONAL_CODEPOINTS.pageDown],
    [57423, FUNCTIONAL_CODEPOINTS.home],
    [57424, FUNCTIONAL_CODEPOINTS.end],
    [57425, FUNCTIONAL_CODEPOINTS.insert],
    [57426, FUNCTIONAL_CODEPOINTS.delete]
  ]);
  function normalizeKittyFunctionalCodepoint(codepoint) {
    return KITTY_FUNCTIONAL_KEY_EQUIVALENTS.get(codepoint) ?? codepoint;
  }
  function normalizeShiftedLetterIdentityCodepoint(codepoint, modifier) {
    const effectiveModifier = modifier & ~LOCK_MASK;
    if ((effectiveModifier & MODIFIERS.shift) !== 0 && codepoint >= 65 && codepoint <= 90) {
      return codepoint + 32;
    }
    return codepoint;
  }
  function getLogicalShiftedSymbolCandidate(codepoint, modifier, allowedSymbols) {
    if (codepoint === void 0 || (modifier & MODIFIERS.shift) === 0) return void 0;
    const normalizedCodepoint = normalizeKittyFunctionalCodepoint(codepoint);
    if (!allowedSymbols.has(String.fromCharCode(normalizedCodepoint))) return void 0;
    return { codepoint: normalizedCodepoint, modifier: modifier & ~MODIFIERS.shift };
  }
  var LEGACY_KEY_SEQUENCES = {
    up: ["\x1B[A", "\x1BOA"],
    down: ["\x1B[B", "\x1BOB"],
    right: ["\x1B[C", "\x1BOC"],
    left: ["\x1B[D", "\x1BOD"],
    home: ["\x1B[H", "\x1BOH", "\x1B[1~", "\x1B[7~"],
    end: ["\x1B[F", "\x1BOF", "\x1B[4~", "\x1B[8~"],
    insert: ["\x1B[2~"],
    delete: ["\x1B[3~"],
    pageUp: ["\x1B[5~", "\x1B[[5~"],
    pageDown: ["\x1B[6~", "\x1B[[6~"],
    clear: ["\x1B[E", "\x1BOE"],
    f1: ["\x1BOP", "\x1B[11~", "\x1B[[A"],
    f2: ["\x1BOQ", "\x1B[12~", "\x1B[[B"],
    f3: ["\x1BOR", "\x1B[13~", "\x1B[[C"],
    f4: ["\x1BOS", "\x1B[14~", "\x1B[[D"],
    f5: ["\x1B[15~", "\x1B[[E"],
    f6: ["\x1B[17~"],
    f7: ["\x1B[18~"],
    f8: ["\x1B[19~"],
    f9: ["\x1B[20~"],
    f10: ["\x1B[21~"],
    f11: ["\x1B[23~"],
    f12: ["\x1B[24~"]
  };
  var LEGACY_SHIFT_SEQUENCES = {
    up: ["\x1B[a"],
    down: ["\x1B[b"],
    right: ["\x1B[c"],
    left: ["\x1B[d"],
    clear: ["\x1B[e"],
    insert: ["\x1B[2$"],
    delete: ["\x1B[3$"],
    pageUp: ["\x1B[5$"],
    pageDown: ["\x1B[6$"],
    home: ["\x1B[7$"],
    end: ["\x1B[8$"]
  };
  var LEGACY_CTRL_SEQUENCES = {
    up: ["\x1BOa"],
    down: ["\x1BOb"],
    right: ["\x1BOc"],
    left: ["\x1BOd"],
    clear: ["\x1BOe"],
    insert: ["\x1B[2^"],
    delete: ["\x1B[3^"],
    pageUp: ["\x1B[5^"],
    pageDown: ["\x1B[6^"],
    home: ["\x1B[7^"],
    end: ["\x1B[8^"]
  };
  var LEGACY_SEQUENCE_KEY_IDS = {
    "\x1BOA": "up",
    "\x1BOB": "down",
    "\x1BOC": "right",
    "\x1BOD": "left",
    "\x1BOH": "home",
    "\x1BOF": "end",
    "\x1B[E": "clear",
    "\x1BOE": "clear",
    "\x1BOe": "ctrl+clear",
    "\x1B[e": "shift+clear",
    "\x1B[2~": "insert",
    "\x1B[2$": "shift+insert",
    "\x1B[2^": "ctrl+insert",
    "\x1B[3$": "shift+delete",
    "\x1B[3^": "ctrl+delete",
    "\x1B[[5~": "pageUp",
    "\x1B[[6~": "pageDown",
    "\x1B[a": "shift+up",
    "\x1B[b": "shift+down",
    "\x1B[c": "shift+right",
    "\x1B[d": "shift+left",
    "\x1BOa": "ctrl+up",
    "\x1BOb": "ctrl+down",
    "\x1BOc": "ctrl+right",
    "\x1BOd": "ctrl+left",
    "\x1B[5$": "shift+pageUp",
    "\x1B[6$": "shift+pageDown",
    "\x1B[7$": "shift+home",
    "\x1B[8$": "shift+end",
    "\x1B[5^": "ctrl+pageUp",
    "\x1B[6^": "ctrl+pageDown",
    "\x1B[7^": "ctrl+home",
    "\x1B[8^": "ctrl+end",
    "\x1BOP": "f1",
    "\x1BOQ": "f2",
    "\x1BOR": "f3",
    "\x1BOS": "f4",
    "\x1B[11~": "f1",
    "\x1B[12~": "f2",
    "\x1B[13~": "f3",
    "\x1B[14~": "f4",
    "\x1B[[A": "f1",
    "\x1B[[B": "f2",
    "\x1B[[C": "f3",
    "\x1B[[D": "f4",
    "\x1B[[E": "f5",
    "\x1B[15~": "f5",
    "\x1B[17~": "f6",
    "\x1B[18~": "f7",
    "\x1B[19~": "f8",
    "\x1B[20~": "f9",
    "\x1B[21~": "f10",
    "\x1B[23~": "f11",
    "\x1B[24~": "f12",
    "\x1Bb": "alt+left",
    "\x1Bf": "alt+right",
    "\x1Bp": "alt+up",
    "\x1Bn": "alt+down"
  };
  var matchesLegacySequence = (data, sequences) => sequences.includes(data);
  var matchesLegacyModifierSequence = (data, key, modifier) => {
    if (modifier === MODIFIERS.shift) {
      return matchesLegacySequence(data, LEGACY_SHIFT_SEQUENCES[key]);
    }
    if (modifier === MODIFIERS.ctrl) {
      return matchesLegacySequence(data, LEGACY_CTRL_SEQUENCES[key]);
    }
    return false;
  };
  var _lastEventType = "press";
  function isKeyRelease(data) {
    if (data.includes("\x1B[200~")) {
      return false;
    }
    if (data.includes(":3u") || data.includes(":3~") || data.includes(":3A") || data.includes(":3B") || data.includes(":3C") || data.includes(":3D") || data.includes(":3H") || data.includes(":3F")) {
      return true;
    }
    return false;
  }
  function parseEventType(eventTypeStr) {
    if (!eventTypeStr) return "press";
    const eventType = parseInt(eventTypeStr, 10);
    if (eventType === 2) return "repeat";
    if (eventType === 3) return "release";
    return "press";
  }
  function parseKittySequence(data) {
    const csiUMatch = data.match(/^\x1b\[(\d+)(?::(\d*))?(?::(\d+))?(?:;(\d+))?(?::(\d+))?u$/);
    if (csiUMatch) {
      const codepoint = parseInt(csiUMatch[1], 10);
      const shiftedKey = csiUMatch[2] && csiUMatch[2].length > 0 ? parseInt(csiUMatch[2], 10) : void 0;
      const baseLayoutKey = csiUMatch[3] ? parseInt(csiUMatch[3], 10) : void 0;
      const modValue = csiUMatch[4] ? parseInt(csiUMatch[4], 10) : 1;
      const eventType = parseEventType(csiUMatch[5]);
      _lastEventType = eventType;
      return { codepoint, shiftedKey, baseLayoutKey, modifier: modValue - 1, eventType };
    }
    const arrowMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([ABCD])$/);
    if (arrowMatch) {
      const modValue = parseInt(arrowMatch[1], 10);
      const eventType = parseEventType(arrowMatch[2]);
      const arrowCodes = { A: -1, B: -2, C: -3, D: -4 };
      _lastEventType = eventType;
      return { codepoint: arrowCodes[arrowMatch[3]], modifier: modValue - 1, eventType };
    }
    const funcMatch = data.match(/^\x1b\[(\d+)(?:;(\d+))?(?::(\d+))?~$/);
    if (funcMatch) {
      const keyNum = parseInt(funcMatch[1], 10);
      const modValue = funcMatch[2] ? parseInt(funcMatch[2], 10) : 1;
      const eventType = parseEventType(funcMatch[3]);
      const funcCodes = {
        2: FUNCTIONAL_CODEPOINTS.insert,
        3: FUNCTIONAL_CODEPOINTS.delete,
        5: FUNCTIONAL_CODEPOINTS.pageUp,
        6: FUNCTIONAL_CODEPOINTS.pageDown,
        7: FUNCTIONAL_CODEPOINTS.home,
        8: FUNCTIONAL_CODEPOINTS.end
      };
      const codepoint = funcCodes[keyNum];
      if (codepoint !== void 0) {
        _lastEventType = eventType;
        return { codepoint, modifier: modValue - 1, eventType };
      }
    }
    const homeEndMatch = data.match(/^\x1b\[1;(\d+)(?::(\d+))?([HF])$/);
    if (homeEndMatch) {
      const modValue = parseInt(homeEndMatch[1], 10);
      const eventType = parseEventType(homeEndMatch[2]);
      const codepoint = homeEndMatch[3] === "H" ? FUNCTIONAL_CODEPOINTS.home : FUNCTIONAL_CODEPOINTS.end;
      _lastEventType = eventType;
      return { codepoint, modifier: modValue - 1, eventType };
    }
    return null;
  }
  function matchesKittySequence(data, expectedCodepoint, expectedModifier) {
    const parsed = parseKittySequence(data);
    if (!parsed) return false;
    const actualMod = parsed.modifier & ~LOCK_MASK;
    const expectedMod = expectedModifier & ~LOCK_MASK;
    const normalizedCodepoint = normalizeShiftedLetterIdentityCodepoint(
      normalizeKittyFunctionalCodepoint(parsed.codepoint),
      parsed.modifier
    );
    const normalizedExpectedCodepoint = normalizeShiftedLetterIdentityCodepoint(
      normalizeKittyFunctionalCodepoint(expectedCodepoint),
      expectedModifier
    );
    if (actualMod === expectedMod && normalizedCodepoint === normalizedExpectedCodepoint) return true;
    const logicalShiftedSymbol = getLogicalShiftedSymbolCandidate(parsed.shiftedKey, actualMod, SYMBOL_KEYS);
    if (logicalShiftedSymbol && (logicalShiftedSymbol.modifier & ~LOCK_MASK) === expectedMod && logicalShiftedSymbol.codepoint === normalizeKittyFunctionalCodepoint(expectedCodepoint)) {
      return true;
    }
    if (actualMod !== expectedMod) return false;
    if (parsed.baseLayoutKey !== void 0 && parsed.baseLayoutKey === expectedCodepoint) {
      const cp = normalizedCodepoint;
      const isLatinLetter = cp >= 97 && cp <= 122;
      const isKnownSymbol = SYMBOL_KEYS.has(String.fromCharCode(cp));
      if (!isLatinLetter && !isKnownSymbol) return true;
    }
    return false;
  }
  function parseModifyOtherKeysSequence(data) {
    const match2 = data.match(/^\x1b\[27;(\d+);(\d+)~$/);
    if (!match2) return null;
    const modValue = parseInt(match2[1], 10);
    const codepoint = parseInt(match2[2], 10);
    return { codepoint, modifier: modValue - 1 };
  }
  function matchesModifyOtherKeys(data, expectedKeycode, expectedModifier) {
    const parsed = parseModifyOtherKeysSequence(data);
    if (!parsed) return false;
    return parsed.codepoint === expectedKeycode && parsed.modifier === expectedModifier;
  }
  function isWindowsTerminalSession() {
    return Boolean(__piProcess.env.WT_SESSION) && !__piProcess.env.SSH_CONNECTION && !__piProcess.env.SSH_CLIENT && !__piProcess.env.SSH_TTY;
  }
  function matchesRawBackspace(data, expectedModifier) {
    if (data === "\x7F") return expectedModifier === 0;
    if (data !== "\b") return false;
    return isWindowsTerminalSession() ? expectedModifier === MODIFIERS.ctrl : expectedModifier === 0;
  }
  function rawCtrlChar(key) {
    const char = key.toLowerCase();
    const code = char.charCodeAt(0);
    if (code >= 97 && code <= 122 || char === "[" || char === "\\" || char === "]" || char === "_") {
      return String.fromCharCode(code & 31);
    }
    if (char === "-") {
      return String.fromCharCode(31);
    }
    return null;
  }
  function isDigitKey(key) {
    return key >= "0" && key <= "9";
  }
  function matchesPrintableModifyOtherKeys(data, expectedKeycode, expectedModifier) {
    const parsed = parseModifyOtherKeysSequence(data);
    if (!parsed) return false;
    const physicalMatch = parsed.modifier === expectedModifier && normalizeShiftedLetterIdentityCodepoint(parsed.codepoint, parsed.modifier) === normalizeShiftedLetterIdentityCodepoint(expectedKeycode, expectedModifier);
    if (physicalMatch) return true;
    const logicalShiftedSymbol = getLogicalShiftedSymbolCandidate(
      parsed.codepoint,
      parsed.modifier,
      SHIFTED_SYMBOL_KEYS
    );
    return logicalShiftedSymbol?.modifier === expectedModifier && logicalShiftedSymbol.codepoint === expectedKeycode;
  }
  function formatKeyNameWithModifiers(keyName, modifier) {
    const mods = [];
    const effectiveMod = modifier & ~LOCK_MASK;
    const supportedModifierMask = MODIFIERS.shift | MODIFIERS.ctrl | MODIFIERS.alt | MODIFIERS.super;
    if ((effectiveMod & ~supportedModifierMask) !== 0) return void 0;
    if (effectiveMod & MODIFIERS.shift) mods.push("shift");
    if (effectiveMod & MODIFIERS.ctrl) mods.push("ctrl");
    if (effectiveMod & MODIFIERS.alt) mods.push("alt");
    if (effectiveMod & MODIFIERS.super) mods.push("super");
    return mods.length > 0 ? `${mods.join("+")}+${keyName}` : keyName;
  }
  function parseKeyId(keyId) {
    let key = keyId.toLowerCase();
    const modifiers = /* @__PURE__ */ new Set();
    while (true) {
      const modifier = MODIFIER_NAMES.find((name) => key.startsWith(`${name}+`));
      if (!modifier) break;
      if (modifiers.has(modifier)) return null;
      modifiers.add(modifier);
      key = key.slice(modifier.length + 1);
    }
    if (!key || key.includes("+") && key !== "+") return null;
    return {
      key,
      ctrl: modifiers.has("ctrl"),
      shift: modifiers.has("shift"),
      alt: modifiers.has("alt"),
      super: modifiers.has("super")
    };
  }
  function matchesKey(data, keyId) {
    const parsed = parseKeyId(keyId);
    if (!parsed) return false;
    const { key, ctrl, shift, alt, super: superModifier } = parsed;
    let modifier = 0;
    if (shift) modifier |= MODIFIERS.shift;
    if (alt) modifier |= MODIFIERS.alt;
    if (ctrl) modifier |= MODIFIERS.ctrl;
    if (superModifier) modifier |= MODIFIERS.super;
    switch (key) {
      case "escape":
      case "esc":
        if (modifier !== 0) return false;
        return data === "\x1B" || matchesKittySequence(data, CODEPOINTS.escape, 0) || matchesModifyOtherKeys(data, CODEPOINTS.escape, 0);
      case "space":
        if (!_kittyProtocolActive) {
          if (modifier === MODIFIERS.ctrl && data === "\0") {
            return true;
          }
          if (modifier === MODIFIERS.alt && data === "\x1B ") {
            return true;
          }
        }
        if (modifier === 0) {
          return data === " " || matchesKittySequence(data, CODEPOINTS.space, 0) || matchesModifyOtherKeys(data, CODEPOINTS.space, 0);
        }
        return matchesKittySequence(data, CODEPOINTS.space, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.space, modifier);
      case "tab":
        if (modifier === MODIFIERS.shift) {
          return data === "\x1B[Z" || matchesKittySequence(data, CODEPOINTS.tab, MODIFIERS.shift) || matchesModifyOtherKeys(data, CODEPOINTS.tab, MODIFIERS.shift);
        }
        if (modifier === 0) {
          return data === "	" || matchesKittySequence(data, CODEPOINTS.tab, 0);
        }
        return matchesKittySequence(data, CODEPOINTS.tab, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.tab, modifier);
      case "enter":
      case "return":
        if (modifier === MODIFIERS.shift) {
          if (matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.shift) || matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.shift)) {
            return true;
          }
          if (matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.shift)) {
            return true;
          }
          if (_kittyProtocolActive) {
            return data === "\x1B\r" || data === "\n";
          }
          return false;
        }
        if (modifier === MODIFIERS.alt) {
          if (matchesKittySequence(data, CODEPOINTS.enter, MODIFIERS.alt) || matchesKittySequence(data, CODEPOINTS.kpEnter, MODIFIERS.alt)) {
            return true;
          }
          if (matchesModifyOtherKeys(data, CODEPOINTS.enter, MODIFIERS.alt)) {
            return true;
          }
          if (!_kittyProtocolActive) {
            return data === "\x1B\r";
          }
          return false;
        }
        if (modifier === 0) {
          return data === "\r" || !_kittyProtocolActive && data === "\n" || data === "\x1BOM" || // SS3 M (numpad enter in some terminals)
          matchesKittySequence(data, CODEPOINTS.enter, 0) || matchesKittySequence(data, CODEPOINTS.kpEnter, 0);
        }
        return matchesKittySequence(data, CODEPOINTS.enter, modifier) || matchesKittySequence(data, CODEPOINTS.kpEnter, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.enter, modifier);
      case "backspace":
        if (modifier === MODIFIERS.alt) {
          if (data === "\x1B\x7F" || data === "\x1B\b") {
            return true;
          }
          return matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.alt) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, MODIFIERS.alt);
        }
        if (modifier === MODIFIERS.ctrl) {
          if (matchesRawBackspace(data, MODIFIERS.ctrl)) return true;
          return matchesKittySequence(data, CODEPOINTS.backspace, MODIFIERS.ctrl) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, MODIFIERS.ctrl);
        }
        if (modifier === 0) {
          return matchesRawBackspace(data, 0) || matchesKittySequence(data, CODEPOINTS.backspace, 0) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, 0);
        }
        return matchesKittySequence(data, CODEPOINTS.backspace, modifier) || matchesModifyOtherKeys(data, CODEPOINTS.backspace, modifier);
      case "insert":
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.insert) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.insert, 0);
        }
        if (matchesLegacyModifierSequence(data, "insert", modifier)) {
          return true;
        }
        return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.insert, modifier);
      case "delete":
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.delete) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, 0);
        }
        if (matchesLegacyModifierSequence(data, "delete", modifier)) {
          return true;
        }
        return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.delete, modifier);
      case "clear":
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.clear);
        }
        return matchesLegacyModifierSequence(data, "clear", modifier);
      case "home":
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.home) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, 0);
        }
        if (matchesLegacyModifierSequence(data, "home", modifier)) {
          return true;
        }
        return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.home, modifier);
      case "end":
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.end) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, 0);
        }
        if (matchesLegacyModifierSequence(data, "end", modifier)) {
          return true;
        }
        return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.end, modifier);
      case "pageup":
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.pageUp) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, 0);
        }
        if (matchesLegacyModifierSequence(data, "pageUp", modifier)) {
          return true;
        }
        return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageUp, modifier);
      case "pagedown":
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.pageDown) || matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, 0);
        }
        if (matchesLegacyModifierSequence(data, "pageDown", modifier)) {
          return true;
        }
        return matchesKittySequence(data, FUNCTIONAL_CODEPOINTS.pageDown, modifier);
      case "up":
        if (modifier === MODIFIERS.alt) {
          return data === "\x1Bp" || matchesKittySequence(data, ARROW_CODEPOINTS.up, MODIFIERS.alt);
        }
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.up) || matchesKittySequence(data, ARROW_CODEPOINTS.up, 0);
        }
        if (matchesLegacyModifierSequence(data, "up", modifier)) {
          return true;
        }
        return matchesKittySequence(data, ARROW_CODEPOINTS.up, modifier);
      case "down":
        if (modifier === MODIFIERS.alt) {
          return data === "\x1Bn" || matchesKittySequence(data, ARROW_CODEPOINTS.down, MODIFIERS.alt);
        }
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.down) || matchesKittySequence(data, ARROW_CODEPOINTS.down, 0);
        }
        if (matchesLegacyModifierSequence(data, "down", modifier)) {
          return true;
        }
        return matchesKittySequence(data, ARROW_CODEPOINTS.down, modifier);
      case "left":
        if (modifier === MODIFIERS.alt) {
          return data === "\x1B[1;3D" || !_kittyProtocolActive && data === "\x1BB" || data === "\x1Bb" || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.alt);
        }
        if (modifier === MODIFIERS.ctrl) {
          return data === "\x1B[1;5D" || matchesLegacyModifierSequence(data, "left", MODIFIERS.ctrl) || matchesKittySequence(data, ARROW_CODEPOINTS.left, MODIFIERS.ctrl);
        }
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.left) || matchesKittySequence(data, ARROW_CODEPOINTS.left, 0);
        }
        if (matchesLegacyModifierSequence(data, "left", modifier)) {
          return true;
        }
        return matchesKittySequence(data, ARROW_CODEPOINTS.left, modifier);
      case "right":
        if (modifier === MODIFIERS.alt) {
          return data === "\x1B[1;3C" || !_kittyProtocolActive && data === "\x1BF" || data === "\x1Bf" || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.alt);
        }
        if (modifier === MODIFIERS.ctrl) {
          return data === "\x1B[1;5C" || matchesLegacyModifierSequence(data, "right", MODIFIERS.ctrl) || matchesKittySequence(data, ARROW_CODEPOINTS.right, MODIFIERS.ctrl);
        }
        if (modifier === 0) {
          return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES.right) || matchesKittySequence(data, ARROW_CODEPOINTS.right, 0);
        }
        if (matchesLegacyModifierSequence(data, "right", modifier)) {
          return true;
        }
        return matchesKittySequence(data, ARROW_CODEPOINTS.right, modifier);
      case "f1":
      case "f2":
      case "f3":
      case "f4":
      case "f5":
      case "f6":
      case "f7":
      case "f8":
      case "f9":
      case "f10":
      case "f11":
      case "f12": {
        if (modifier !== 0) {
          return false;
        }
        const functionKey = key;
        return matchesLegacySequence(data, LEGACY_KEY_SEQUENCES[functionKey]);
      }
    }
    if (key.length === 1 && (key >= "a" && key <= "z" || isDigitKey(key) || SYMBOL_KEYS.has(key))) {
      const codepoint = key.charCodeAt(0);
      const rawCtrl = rawCtrlChar(key);
      const isLetter = key >= "a" && key <= "z";
      const isDigit = isDigitKey(key);
      if (modifier === MODIFIERS.ctrl + MODIFIERS.alt && !_kittyProtocolActive && rawCtrl) {
        if (data === `\x1B${rawCtrl}`) return true;
      }
      if (modifier === MODIFIERS.alt && !_kittyProtocolActive && (isLetter || isDigit || SYMBOL_KEYS.has(key))) {
        if (data === `\x1B${key}`) return true;
      }
      if (modifier === MODIFIERS.ctrl) {
        if (rawCtrl && data === rawCtrl) return true;
        return matchesKittySequence(data, codepoint, MODIFIERS.ctrl) || matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.ctrl);
      }
      if (modifier === MODIFIERS.shift + MODIFIERS.ctrl) {
        return matchesKittySequence(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl) || matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.shift + MODIFIERS.ctrl);
      }
      if (modifier === MODIFIERS.shift) {
        if (isLetter && data === key.toUpperCase()) return true;
        return matchesKittySequence(data, codepoint, MODIFIERS.shift) || matchesPrintableModifyOtherKeys(data, codepoint, MODIFIERS.shift);
      }
      if (modifier !== 0) {
        return matchesKittySequence(data, codepoint, modifier) || matchesPrintableModifyOtherKeys(data, codepoint, modifier);
      }
      return data === key || matchesKittySequence(data, codepoint, 0) || matchesPrintableModifyOtherKeys(data, codepoint, 0);
    }
    return false;
  }
  function formatParsedKey(codepoint, modifier, baseLayoutKey) {
    const normalizedCodepoint = normalizeKittyFunctionalCodepoint(codepoint);
    const identityCodepoint = normalizeShiftedLetterIdentityCodepoint(normalizedCodepoint, modifier);
    const isLatinLetter = identityCodepoint >= 97 && identityCodepoint <= 122;
    const isDigit = identityCodepoint >= 48 && identityCodepoint <= 57;
    const isKnownSymbol = SYMBOL_KEYS.has(String.fromCharCode(identityCodepoint));
    const effectiveCodepoint = isLatinLetter || isDigit || isKnownSymbol ? identityCodepoint : baseLayoutKey ?? identityCodepoint;
    let keyName;
    if (effectiveCodepoint === CODEPOINTS.escape) keyName = "escape";
    else if (effectiveCodepoint === CODEPOINTS.tab) keyName = "tab";
    else if (effectiveCodepoint === CODEPOINTS.enter || effectiveCodepoint === CODEPOINTS.kpEnter) keyName = "enter";
    else if (effectiveCodepoint === CODEPOINTS.space) keyName = "space";
    else if (effectiveCodepoint === CODEPOINTS.backspace) keyName = "backspace";
    else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.delete) keyName = "delete";
    else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.insert) keyName = "insert";
    else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.home) keyName = "home";
    else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.end) keyName = "end";
    else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.pageUp) keyName = "pageUp";
    else if (effectiveCodepoint === FUNCTIONAL_CODEPOINTS.pageDown) keyName = "pageDown";
    else if (effectiveCodepoint === ARROW_CODEPOINTS.up) keyName = "up";
    else if (effectiveCodepoint === ARROW_CODEPOINTS.down) keyName = "down";
    else if (effectiveCodepoint === ARROW_CODEPOINTS.left) keyName = "left";
    else if (effectiveCodepoint === ARROW_CODEPOINTS.right) keyName = "right";
    else if (effectiveCodepoint >= 48 && effectiveCodepoint <= 57) keyName = String.fromCharCode(effectiveCodepoint);
    else if (effectiveCodepoint >= 97 && effectiveCodepoint <= 122) keyName = String.fromCharCode(effectiveCodepoint);
    else if (SYMBOL_KEYS.has(String.fromCharCode(effectiveCodepoint))) keyName = String.fromCharCode(effectiveCodepoint);
    if (!keyName) return void 0;
    return formatKeyNameWithModifiers(keyName, modifier);
  }
  function parseKey(data) {
    const kitty = parseKittySequence(data);
    if (kitty) {
      const logicalShiftedSymbol = getLogicalShiftedSymbolCandidate(kitty.shiftedKey, kitty.modifier, SYMBOL_KEYS);
      return formatParsedKey(
        logicalShiftedSymbol?.codepoint ?? kitty.codepoint,
        logicalShiftedSymbol?.modifier ?? kitty.modifier,
        kitty.baseLayoutKey
      );
    }
    const modifyOtherKeys = parseModifyOtherKeysSequence(data);
    if (modifyOtherKeys) {
      const logicalShiftedSymbol = getLogicalShiftedSymbolCandidate(
        modifyOtherKeys.codepoint,
        modifyOtherKeys.modifier,
        SHIFTED_SYMBOL_KEYS
      );
      return formatParsedKey(
        logicalShiftedSymbol?.codepoint ?? modifyOtherKeys.codepoint,
        logicalShiftedSymbol?.modifier ?? modifyOtherKeys.modifier
      );
    }
    if (_kittyProtocolActive) {
      if (data === "\x1B\r" || data === "\n") return "shift+enter";
    }
    const legacySequenceKeyId = LEGACY_SEQUENCE_KEY_IDS[data];
    if (legacySequenceKeyId) return legacySequenceKeyId;
    if (data === "\x1B") return "escape";
    if (data === "") return "ctrl+\\";
    if (data === "") return "ctrl+]";
    if (data === "") return "ctrl+-";
    if (data === "\x1B\x1B") return "ctrl+alt+[";
    if (data === "\x1B") return "ctrl+alt+\\";
    if (data === "\x1B") return "ctrl+alt+]";
    if (data === "\x1B") return "ctrl+alt+-";
    if (data === "	") return "tab";
    if (data === "\r" || !_kittyProtocolActive && data === "\n" || data === "\x1BOM") return "enter";
    if (data === "\0") return "ctrl+space";
    if (data === " ") return "space";
    if (data === "\x7F") return "backspace";
    if (data === "\b") return isWindowsTerminalSession() ? "ctrl+backspace" : "backspace";
    if (data === "\x1B[Z") return "shift+tab";
    if (!_kittyProtocolActive && data === "\x1B\r") return "alt+enter";
    if (!_kittyProtocolActive && data === "\x1B ") return "alt+space";
    if (data === "\x1B\x7F" || data === "\x1B\b") return "alt+backspace";
    if (!_kittyProtocolActive && data === "\x1BB") return "alt+left";
    if (!_kittyProtocolActive && data === "\x1BF") return "alt+right";
    if (!_kittyProtocolActive && data.length === 2 && data[0] === "\x1B") {
      const code = data.charCodeAt(1);
      if (code >= 1 && code <= 26) {
        return `ctrl+alt+${String.fromCharCode(code + 96)}`;
      }
      const key = String.fromCharCode(code);
      if (code >= 97 && code <= 122 || code >= 48 && code <= 57 || SYMBOL_KEYS.has(key)) {
        return `alt+${key}`;
      }
    }
    if (data === "\x1B[A") return "up";
    if (data === "\x1B[B") return "down";
    if (data === "\x1B[C") return "right";
    if (data === "\x1B[D") return "left";
    if (data === "\x1B[H" || data === "\x1BOH") return "home";
    if (data === "\x1B[F" || data === "\x1BOF") return "end";
    if (data === "\x1B[3~") return "delete";
    if (data === "\x1B[5~") return "pageUp";
    if (data === "\x1B[6~") return "pageDown";
    if (data.length === 1) {
      const code = data.charCodeAt(0);
      if (code >= 1 && code <= 26) {
        return `ctrl+${String.fromCharCode(code + 96)}`;
      }
      if (code >= 32 && code <= 126) {
        return data;
      }
    }
    return void 0;
  }
  var KITTY_PRINTABLE_ALLOWED_MODIFIERS = MODIFIERS.shift | LOCK_MASK;


  var node_os_exports = {};
  __export(node_os_exports, {
    EOL: () => EOL,
    arch: () => arch,
    constants: () => constants,
    cpus: () => cpus,
    default: () => node_os_default,
    devNull: () => devNull,
    endianness: () => endianness,
    freemem: () => freemem,
    homedir: () => homedir,
    hostname: () => hostname,
    loadavg: () => loadavg,
    networkInterfaces: () => networkInterfaces,
    platform: () => platform,
    release: () => release,
    tmpdir: () => tmpdir,
    totalmem: () => totalmem,
    type: () => type,
    uptime: () => uptime,
    userInfo: () => userInfo,
    version: () => version
  });
  var homedir = () => __piProcess.env.HOME ?? __piProcess.env.USERPROFILE ?? "/";
  var tmpdir = () => __piProcess.env.TMPDIR ?? "/tmp";
  var platform = () => __piProcess.platform;
  var arch = () => __piProcess.arch;
  var EOL = "\n";
  var hostname = () => "localhost";
  var userInfo = () => ({
    username: __piProcess.env.USER ?? __piProcess.env.LOGNAME ?? "user",
    homedir: homedir(),
    shell: __piProcess.env.SHELL ?? "/bin/sh"
  });
  var release = () => "";
  var version = () => "";
  var uptime = () => 0;
  var loadavg = () => [0, 0, 0];
  var networkInterfaces = () => ({});
  var cpus = () => [];
  var endianness = () => "LE";
  var type = () => "Linux";
  var freemem = () => 0;
  var totalmem = () => 0;
  var devNull = "/dev/null";
  var constants = {
    E2BIG: 7,
    EACCES: 13,
    EAGAIN: 11,
    EBADF: 9,
    EBUSY: 16,
    EEXIST: 17,
    EFAULT: 14,
    EINTR: 4,
    EINVAL: 22,
    EISDIR: 21,
    ELOOP: 40,
    EMFILE: 24,
    ENAMETOOLONG: 36,
    ENOENT: 2,
    ENOMEM: 12,
    ENOSPC: 28,
    ENOTDIR: 20,
    ENOTEMPTY: 39,
    EPERM: 1,
    EPIPE: 32,
    ERANGE: 34,
    EROFS: 30,
    ESPIPE: 29,
    EXDEV: 18
  };
  var node_os_default = {
    homedir,
    tmpdir,
    platform,
    arch,
    hostname,
    userInfo,
    release,
    version,
    uptime,
    loadavg,
    networkInterfaces,
    cpus,
    endianness,
    type,
    freemem,
    totalmem,
    devNull,
    EOL,
    constants
  };


  var node_path_exports = {};
  __export(node_path_exports, {
    basename: () => basename,
    default: () => node_path_default,
    delimiter: () => delimiter,
    dirname: () => dirname,
    extname: () => extname,
    format: () => format,
    isAbsolute: () => isAbsolute,
    join: () => join,
    normalize: () => normalize,
    parse: () => parse,
    posix: () => posix,
    relative: () => relative,
    resolve: () => resolve,
    sep: () => sep,
    toNamespacedPath: () => toNamespacedPath,
    win32: () => win32
  });
  var modules = globalThis.__piNodeModules;
  var path = modules["node:path"];
  var sep = path.sep;
  var delimiter = path.delimiter;
  var join = path.join;
  var normalize = path.normalize;
  var resolve = path.resolve;
  var dirname = path.dirname;
  var basename = path.basename;
  var extname = path.extname;
  var relative = path.relative;
  var isAbsolute = path.isAbsolute;
  var parse = path.parse;
  var format = path.format;
  var variant = {
    sep: path.sep,
    delimiter: path.delimiter,
    join: path.join,
    normalize: path.normalize,
    resolve: path.resolve,
    dirname: path.dirname,
    basename: path.basename,
    extname: path.extname,
    relative: path.relative,
    isAbsolute: path.isAbsolute,
    parse: path.parse,
    format: path.format
  };
  var toNamespacedPath = (value) => value;
  var win32 = variant;
  var posix = variant;
  var node_path_default = { ...path, win32, posix, toNamespacedPath };


  var node_url_exports = {};
  __export(node_url_exports, {
    default: () => node_url_default,
    fileURLToPath: () => fileURLToPath,
    pathToFileURL: () => pathToFileURL
  });
  var pathToFileURL = (value) => ({
    href: `file://${value}`,
    pathname: value,
    protocol: "file:",
    toString: () => `file://${value}`
  });
  var fileURLToPath = (value) => typeof value === "string" ? value.replace(/^file:\/\//, "") : value.pathname;
  var node_url_default = { pathToFileURL, fileURLToPath };


  var node_child_process_exports = {};
  __export(node_child_process_exports, {
    default: () => node_child_process_default,
    exec: () => exec,
    execFile: () => execFile,
    execSync: () => execSync,
    spawn: () => spawn,
    spawnSync: () => spawnSync
  });
  var unavailable = (name) => () => {
    throw new Error(`${name} is not available in the embedded extension host`);
  };
  var execSync = unavailable("execSync");
  var exec = unavailable("exec");
  var execFile = unavailable("execFile");
  var spawn = unavailable("spawn");
  var spawnSync = unavailable("spawnSync");
  var node_child_process_default = { execSync, exec, execFile, spawn, spawnSync };


  function dispatchMouseEvent(component, event) {
    const result = component.handleMouse?.(event);
    if (!result) return void 0;
    if ("target" in result) {
      const forwarded = result;
      return forwarded.focus && component.handleInput ? { ...forwarded, focusTarget: component } : forwarded;
    }
    if (!result.handled && !result.capture && !result.focus) return void 0;
    return {
      ...result,
      handled: true,
      ...result.focus ? { focusTarget: component } : {},
      target: {
        component,
        originX: event.screenX - event.x,
        originY: event.screenY - event.y,
        width: event.width,
        height: event.height
      }
    };
  }
  var TERMINAL_PALETTE_SIZE = 16;
  var TERMINAL_COLOR_REPLY_COUNT = 2 + TERMINAL_PALETTE_SIZE;
  var TERMINAL_COLOR_QUERY = `\x1B]10;?\x07\x1B]11;?\x07${Array.from(
    { length: TERMINAL_PALETTE_SIZE },
    (_, index3) => `\x1B]4;${index3};?\x07`
  ).join("")}\x1B[c`;
  var CURSOR_MARKER = "\x1B_pi:c\x07";
  var FAKE_CURSOR_START = "\x1B_pi:fc\x07";
  var FAKE_CURSOR_END = "\x1B_pi:/fc\x07";
  function renderFakeCursor(text) {
    return `${FAKE_CURSOR_START}${text}${FAKE_CURSOR_END}`;
  }
  var Container = class {
    children = [];
    mouseLayout;
    /** Child whose overlay is painted above this container, if any. */
    overlayOwner;
    /** Row of the overlay owner's box inside this container. */
    overlayRow = 0;
    /** Height of the overlay owner's box. */
    overlayOwnerHeight = 0;
    /** Number of rows the overlay covers above the owner's box. */
    overlayHeight = 0;
    addChild(component) {
      this.children.push(component);
    }
    removeChild(component) {
      const index3 = this.children.indexOf(component);
      if (index3 !== -1) {
        this.children.splice(index3, 1);
      }
    }
    clear() {
      this.children = [];
    }
    invalidate() {
      for (const child of this.children) {
        child.invalidate?.();
      }
    }
    handleMouse(event) {
      const overlayRows = this.getOverlayAboveRows();
      if (overlayRows && event.y >= overlayRows.start && event.y < overlayRows.end) {
        const owner = this.overlayOwner;
        if (!owner) return void 0;
        return dispatchMouseEvent(owner, {
          ...event,
          y: event.y - this.overlayRow,
          height: this.overlayOwnerHeight || event.height
        });
      }
      if (event.y < 0) {
        const owner = this.overlayOwner;
        if (!owner) return void 0;
        return dispatchMouseEvent(owner, {
          ...event,
          y: event.y - this.overlayRow,
          height: this.overlayOwnerHeight || event.height
        });
      }
      if (event.y >= event.height) return void 0;
      const mouseChildren = this.mouseLayout?.width === event.width ? this.mouseLayout.children : this.children.map((component) => ({ component, height: component.render(event.width).length }));
      let childY = 0;
      for (const { component: child, height: childHeight } of mouseChildren) {
        const overlayRows2 = child.getOverlayAboveRows?.();
        if (overlayRows2 && event.y >= childY + overlayRows2.start && event.y < childY + overlayRows2.end) {
          const result = dispatchMouseEvent(child, {
            ...event,
            y: event.y - childY,
            height: childHeight
          });
          if (result?.focus && this.handleInput) return { ...result, focusTarget: this };
          return result;
        }
        if (event.y >= childY && event.y < childY + childHeight) {
          const result = dispatchMouseEvent(child, {
            ...event,
            y: event.y - childY,
            height: childHeight
          });
          if (result?.focus && this.handleInput) return { ...result, focusTarget: this };
          return result;
        }
        childY += childHeight;
      }
      return void 0;
    }
    render(width) {
      const lines = [];
      const mouseChildren = [];
      for (const child of this.children) {
        const childLines = child.render(width);
        mouseChildren.push({ component: child, height: childLines.length });
        for (const line of childLines) {
          lines.push(line);
        }
      }
      this.mouseLayout = { width, children: mouseChildren };
      return lines;
    }
    /**
     * The overlay of the first child that has one. The overlay is painted above that
     * child's own box, so the container keeps track of the row the child sits at.
     */
    renderOverlayAbove(width) {
      this.overlayOwner = void 0;
      this.overlayRow = 0;
      this.overlayOwnerHeight = 0;
      this.overlayHeight = 0;
      const layout = this.mouseLayout?.width === width ? this.mouseLayout : void 0;
      let row = 0;
      for (let index3 = 0; index3 < this.children.length; index3++) {
        const child = this.children[index3];
        const overlay = child.renderOverlayAbove?.(width);
        if (overlay && overlay.length > 0) {
          this.overlayOwner = child;
          this.overlayRow = row;
          this.overlayOwnerHeight = layout?.children[index3]?.height ?? child.render(width).length;
          this.overlayHeight = overlay.length;
          return overlay;
        }
        row += layout?.children[index3]?.height ?? child.render(width).length;
      }
      return [];
    }
    /**
     * The rows of this container that the overlay of a child covers, relative to the
     * box of this container. The overlay sits above the box of the child that owns it.
     */
    getOverlayAboveRows() {
      if (!this.overlayOwner || this.overlayHeight === 0) return void 0;
      return { start: this.overlayRow - this.overlayHeight, end: this.overlayRow };
    }
    /** Row inside this container where the overlay's bottom edge sits. */
    getOverlayRow() {
      return this.overlayRow;
    }
  };


  var Box = class {
    children = [];
    paddingX;
    paddingY;
    bgFn;
    // Cache for rendered output
    cache;
    mouseLayout;
    constructor(paddingX = 1, paddingY = 1, bgFn) {
      this.paddingX = paddingX;
      this.paddingY = paddingY;
      this.bgFn = bgFn;
    }
    addChild(component) {
      this.children.push(component);
      this.invalidateCache();
    }
    removeChild(component) {
      const index3 = this.children.indexOf(component);
      if (index3 !== -1) {
        this.children.splice(index3, 1);
        this.invalidateCache();
      }
    }
    clear() {
      this.children = [];
      this.invalidateCache();
    }
    setBgFn(bgFn) {
      this.bgFn = bgFn;
    }
    setPaddingX(paddingX) {
      this.paddingX = paddingX;
      this.invalidateCache();
    }
    invalidateCache() {
      this.cache = void 0;
    }
    matchCache(width, childLines, bgSample) {
      const cache = this.cache;
      return !!cache && cache.width === width && cache.bgSample === bgSample && cache.childLines.length === childLines.length && cache.childLines.every((line, i) => line === childLines[i]);
    }
    invalidate() {
      this.invalidateCache();
      for (const child of this.children) {
        child.invalidate?.();
      }
    }
    handleMouse(event) {
      const contentWidth = Math.max(1, event.width - this.paddingX * 2);
      const contentY = event.y - this.paddingY;
      const contentX = event.x - this.paddingX;
      if (contentY < 0 || contentX < 0 || contentX >= contentWidth) return void 0;
      const mouseChildren = this.mouseLayout?.width === contentWidth ? this.mouseLayout.children : this.children.map((component) => ({ component, height: component.render(contentWidth).length }));
      let childY = 0;
      for (const { component: child, height: childHeight } of mouseChildren) {
        if (contentY >= childY && contentY < childY + childHeight) {
          return dispatchMouseEvent(child, {
            ...event,
            x: contentX,
            y: contentY - childY,
            width: contentWidth,
            height: childHeight
          });
        }
        childY += childHeight;
      }
      return void 0;
    }
    render(width) {
      if (this.children.length === 0) {
        return [];
      }
      const contentWidth = Math.max(1, width - this.paddingX * 2);
      const leftPad = " ".repeat(this.paddingX);
      const childLines = [];
      const mouseChildren = [];
      for (const child of this.children) {
        const lines = child.render(contentWidth);
        mouseChildren.push({ component: child, height: lines.length });
        for (const line of lines) {
          childLines.push(line);
        }
      }
      this.mouseLayout = { width: contentWidth, children: mouseChildren };
      if (childLines.length === 0) {
        return [];
      }
      const bgSample = this.bgFn ? this.bgFn("test") : void 0;
      if (this.matchCache(width, childLines, bgSample)) {
        return this.cache.lines;
      }
      const result = [];
      for (let i = 0; i < this.paddingY; i++) {
        result.push(this.applyBg("", width));
      }
      for (const line of childLines) {
        result.push(this.applyBg(leftPad + line, width));
      }
      for (let i = 0; i < this.paddingY; i++) {
        result.push(this.applyBg("", width));
      }
      flattenLines(result);
      this.cache = { childLines, width, bgSample, lines: result };
      return result;
    }
    applyBg(line, width) {
      const visLen = visibleWidth(line);
      const padNeeded = Math.max(0, width - visLen);
      const padded = line + " ".repeat(padNeeded);
      return this.bgFn ? this.bgFn(padded) : padded;
    }
  };


  var TUI_KEYBINDINGS = {
    "tui.editor.cursorUp": { defaultKeys: "up", description: "Move cursor up" },
    "tui.editor.cursorDown": { defaultKeys: "down", description: "Move cursor down" },
    "tui.editor.historyPrevious": {
      defaultKeys: [],
      description: "Select previous prompt history entry"
    },
    "tui.editor.historyNext": {
      defaultKeys: [],
      description: "Select next prompt history entry"
    },
    "tui.editor.cursorLeft": {
      defaultKeys: ["left", "ctrl+b"],
      description: "Move cursor left"
    },
    "tui.editor.cursorRight": {
      defaultKeys: ["right", "ctrl+f"],
      description: "Move cursor right"
    },
    "tui.editor.cursorWordLeft": {
      defaultKeys: ["alt+left", "ctrl+left", "alt+b"],
      description: "Move cursor word left"
    },
    "tui.editor.cursorWordRight": {
      defaultKeys: ["alt+right", "ctrl+right", "alt+f"],
      description: "Move cursor word right"
    },
    "tui.editor.cursorLineStart": {
      defaultKeys: ["home", "ctrl+a"],
      description: "Move to line start"
    },
    "tui.editor.jumpForward": {
      defaultKeys: "ctrl+]",
      description: "Jump forward to character"
    },
    "tui.editor.jumpBackward": {
      defaultKeys: "ctrl+alt+]",
      description: "Jump backward to character"
    },
    "tui.editor.pageUp": { defaultKeys: ["pageUp", "ctrl+pageUp"], description: "Page up" },
    "tui.editor.pageDown": { defaultKeys: ["pageDown", "ctrl+pageDown"], description: "Page down" },
    "tui.editor.deleteCharBackward": {
      defaultKeys: "backspace",
      description: "Delete character backward"
    },
    "tui.editor.deleteCharForward": {
      defaultKeys: ["delete", "ctrl+d"],
      description: "Delete character forward"
    },
    "tui.editor.deleteWordBackward": {
      defaultKeys: ["ctrl+w", "alt+backspace"],
      description: "Delete word backward"
    },
    "tui.editor.deleteWordForward": {
      defaultKeys: ["alt+d", "alt+delete"],
      description: "Delete word forward"
    },
    "tui.editor.deleteToLineStart": {
      defaultKeys: "ctrl+u",
      description: "Delete to line start"
    },
    "tui.editor.deleteToLineEnd": {
      defaultKeys: "ctrl+k",
      description: "Delete to line end"
    },
    "tui.editor.yank": { defaultKeys: "ctrl+y", description: "Yank" },
    "tui.editor.yankPop": { defaultKeys: "alt+y", description: "Yank pop" },
    "tui.editor.undo": { defaultKeys: "ctrl+-", description: "Undo" },
    "tui.input.newLine": { defaultKeys: ["shift+enter", "ctrl+j"], description: "Insert newline" },
    "tui.input.submit": { defaultKeys: "enter", description: "Submit input" },
    "tui.input.tab": { defaultKeys: "tab", description: "Tab / autocomplete" },
    "tui.input.copy": { defaultKeys: "ctrl+c", description: "Copy selection" },
    "tui.select.up": { defaultKeys: "up", description: "Move selection up" },
    "tui.select.down": { defaultKeys: "down", description: "Move selection down" },
    "tui.select.pageUp": { defaultKeys: "pageUp", description: "Selection page up" },
    "tui.select.pageDown": {
      defaultKeys: "pageDown",
      description: "Selection page down"
    },
    "tui.select.confirm": { defaultKeys: "enter", description: "Confirm selection" },
    "tui.select.cancel": {
      defaultKeys: ["escape", "ctrl+c"],
      description: "Cancel selection"
    },
    // These intentionally shadow the unmodified editor bindings in fullscreen mode.
    "tui.altScreen.pageUp": {
      defaultKeys: "pageUp",
      description: "Scroll viewport up one page"
    },
    "tui.altScreen.pageDown": {
      defaultKeys: "pageDown",
      description: "Scroll viewport down one page"
    },
    "tui.altScreen.halfPageUp": {
      defaultKeys: [],
      description: "Scroll viewport up half a page"
    },
    "tui.altScreen.halfPageDown": {
      defaultKeys: [],
      description: "Scroll viewport down half a page"
    },
    "tui.altScreen.lineUp": {
      defaultKeys: [],
      description: "Scroll viewport up one line"
    },
    "tui.altScreen.lineDown": {
      defaultKeys: [],
      description: "Scroll viewport down one line"
    },
    "tui.altScreen.previousPrompt": {
      defaultKeys: ["ctrl+shift+up", "ctrl+up"],
      description: "Jump to previous semantic prompt"
    },
    "tui.altScreen.nextPrompt": {
      defaultKeys: ["ctrl+shift+down", "ctrl+down"],
      description: "Jump to next semantic prompt"
    },
    "tui.altScreen.search": {
      defaultKeys: "ctrl+shift+f",
      description: "Search the primary scroll view"
    },
    "tui.altScreen.searchNext": {
      defaultKeys: ["enter", "ctrl+g"],
      description: "Select the next search match"
    },
    "tui.altScreen.searchPrevious": {
      defaultKeys: ["shift+enter", "ctrl+shift+g"],
      description: "Select the previous search match"
    },
    "tui.altScreen.searchClose": {
      defaultKeys: "escape",
      description: "Close transcript search"
    },
    "tui.altScreen.top": { defaultKeys: [], description: "Scroll viewport to top" },
    // Ctrl+E shadows the editor's cursor-to-line-end binding in fullscreen mode, like the
    // other alt-screen viewport keys.
    "tui.altScreen.bottom": { defaultKeys: "ctrl+e", description: "Scroll viewport to bottom" }
  };
  function normalizeKeys(keys) {
    if (keys === void 0) return [];
    const keyList = Array.isArray(keys) ? keys : [keys];
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const key of keyList) {
      if (!seen.has(key)) {
        seen.add(key);
        result.push(key);
      }
    }
    return result;
  }
  var KeybindingsManager = class {
    definitions;
    userBindings;
    keysById = /* @__PURE__ */ new Map();
    conflicts = [];
    constructor(definitions, userBindings = {}) {
      this.definitions = definitions;
      this.userBindings = userBindings;
      this.rebuild();
    }
    rebuild() {
      this.keysById.clear();
      this.conflicts = [];
      const userClaims = /* @__PURE__ */ new Map();
      for (const [keybinding, keys] of Object.entries(this.userBindings)) {
        if (!(keybinding in this.definitions)) continue;
        for (const key of normalizeKeys(keys)) {
          const claimants = userClaims.get(key) ?? /* @__PURE__ */ new Set();
          claimants.add(keybinding);
          userClaims.set(key, claimants);
        }
      }
      for (const [key, keybindings] of userClaims) {
        if (keybindings.size > 1) {
          this.conflicts.push({ key, keybindings: [...keybindings] });
        }
      }
      for (const [id, definition] of Object.entries(this.definitions)) {
        const userKeys = this.userBindings[id];
        const keys = userKeys === void 0 ? normalizeKeys(definition.defaultKeys) : normalizeKeys(userKeys);
        this.keysById.set(id, keys);
      }
    }
    matches(data, keybinding) {
      const keys = this.keysById.get(keybinding) ?? [];
      for (const key of keys) {
        if (matchesKey(data, key)) return true;
      }
      return false;
    }
    getKeys(keybinding) {
      return [...this.keysById.get(keybinding) ?? []];
    }
    getDefinition(keybinding) {
      return this.definitions[keybinding];
    }
    getConflicts() {
      return this.conflicts.map((conflict) => ({ ...conflict, keybindings: [...conflict.keybindings] }));
    }
    setUserBindings(userBindings) {
      this.userBindings = userBindings;
      this.rebuild();
    }
    getUserBindings() {
      return { ...this.userBindings };
    }
    getResolvedBindings() {
      const resolved = {};
      for (const id of Object.keys(this.definitions)) {
        const keys = this.keysById.get(id) ?? [];
        resolved[id] = keys.length === 1 ? keys[0] : [...keys];
      }
      return resolved;
    }
  };
  var globalKeybindings = null;
  function getKeybindings() {
    if (!globalKeybindings) {
      globalKeybindings = new KeybindingsManager(TUI_KEYBINDINGS);
    }
    return globalKeybindings;
  }


  function applyHover(event, list) {
    if (event.type !== "move") return false;
    const index3 = list.indexAtRow(event.y);
    if (index3 === void 0) return false;
    return list.select(index3);
  }


  var DEFAULT_PRIMARY_COLUMN_WIDTH = 32;
  var PRIMARY_COLUMN_GAP = 2;
  var MIN_DESCRIPTION_WIDTH = 10;
  var normalizeToSingleLine = (text) => text.replace(/[\r\n]+/g, " ").trim();
  var clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  var SelectList = class {
    items = [];
    filteredItems = [];
    selectedIndex = 0;
    /**
     * Top of the visible window. Tracked separately from the selection so a
     * hover can move the selection without scrolling the list out from under
     * the pointer.
     */
    windowStart = 0;
    mousePressedIndex;
    maxVisible = 5;
    theme;
    layout;
    onSelect;
    onCancel;
    onSelectionChange;
    constructor(items, maxVisible, theme2, layout = {}) {
      this.items = items;
      this.filteredItems = items;
      this.maxVisible = maxVisible;
      this.theme = theme2;
      this.layout = layout;
    }
    setFilter(filter) {
      this.filteredItems = this.items.filter((item) => item.value.toLowerCase().startsWith(filter.toLowerCase()));
      this.selectedIndex = 0;
      this.windowStart = 0;
    }
    /** Replaces the items of the list and clears the filter. */
    setItems(items) {
      this.items = items;
      this.filteredItems = items;
      this.selectedIndex = 0;
      this.windowStart = 0;
    }
    setSelectedIndex(index3) {
      this.selectedIndex = Math.max(0, Math.min(index3, this.filteredItems.length - 1));
      this.scrollToSelection();
    }
    invalidate() {
    }
    render(width) {
      const lines = [];
      if (this.filteredItems.length === 0) {
        lines.push(this.theme.noMatch("  No matching commands"));
        return lines;
      }
      const primaryColumnWidth = this.layout.renderItem ? 0 : this.getPrimaryColumnWidth();
      const { startIndex, endIndex } = this.getVisibleRange();
      for (let i = startIndex; i < endIndex; i++) {
        const item = this.filteredItems[i];
        if (!item) continue;
        const isSelected = i === this.selectedIndex;
        if (this.layout.renderItem) {
          lines.push(this.layout.renderItem(item, isSelected, width));
          continue;
        }
        const descriptionSingleLine = item.description ? normalizeToSingleLine(item.description) : void 0;
        lines.push(this.renderItem(item, isSelected, width, descriptionSingleLine, primaryColumnWidth));
      }
      if (startIndex > 0 || endIndex < this.filteredItems.length) {
        const scrollText = `  (${this.selectedIndex + 1}/${this.filteredItems.length})`;
        lines.push(this.theme.scrollInfo(truncateToWidth(scrollText, width - 2, "")));
      }
      return lines;
    }
    handleMouse(event) {
      if (this.filteredItems.length === 0) return void 0;
      if (event.type === "wheel" && event.wheelDelta) {
        const delta = event.wheelDelta < 0 ? -1 : 1;
        const previousIndex = this.selectedIndex;
        this.selectedIndex = Math.max(0, Math.min(this.filteredItems.length - 1, this.selectedIndex + delta));
        if (this.selectedIndex !== previousIndex) {
          this.scrollToSelection();
          this.notifySelectionChange();
        }
        return { handled: true, render: this.selectedIndex !== previousIndex };
      }
      if (applyHover(event, this)) {
        this.notifySelectionChange();
        return { handled: true, render: true };
      }
      if (event.button !== "left" || event.type !== "press" && event.type !== "click") return void 0;
      const { startIndex, endIndex } = this.getVisibleRange();
      const itemIndex = startIndex + event.y;
      if (itemIndex < startIndex || itemIndex >= endIndex) return void 0;
      if (event.type === "press") {
        this.mousePressedIndex = itemIndex;
        if (this.selectedIndex !== itemIndex) {
          this.selectedIndex = itemIndex;
          this.notifySelectionChange();
        }
        return { handled: true, focus: true };
      }
      if (event.type === "click") {
        const clickedIndex = this.mousePressedIndex ?? itemIndex;
        this.mousePressedIndex = void 0;
        const changed = this.selectedIndex !== clickedIndex;
        this.selectedIndex = clickedIndex;
        if (changed) this.notifySelectionChange();
        const selectedItem = this.filteredItems[this.selectedIndex];
        if (selectedItem) this.onSelect?.(selectedItem);
        return { handled: true };
      }
      return void 0;
    }
    /** Index of the item on the given row, or undefined when the row holds no item. */
    indexAtRow(row) {
      const { startIndex, endIndex } = this.getVisibleRange();
      const index3 = startIndex + row;
      return index3 >= startIndex && index3 < endIndex ? index3 : void 0;
    }
    /**
     * Move the selection. The visible window stays put so a hover keeps the
     * row under the pointer; the window follows the selection on the next
     * keyboard move.
     */
    select(index3) {
      if (index3 === this.selectedIndex) return false;
      this.selectedIndex = index3;
      return true;
    }
    handleInput(keyData) {
      const kb = getKeybindings();
      if (kb.matches(keyData, "tui.select.up")) {
        this.selectedIndex = this.selectedIndex === 0 ? this.filteredItems.length - 1 : this.selectedIndex - 1;
        this.scrollToSelection();
        this.notifySelectionChange();
      } else if (kb.matches(keyData, "tui.select.down")) {
        this.selectedIndex = this.selectedIndex === this.filteredItems.length - 1 ? 0 : this.selectedIndex + 1;
        this.scrollToSelection();
        this.notifySelectionChange();
      } else if (kb.matches(keyData, "tui.select.confirm")) {
        const selectedItem = this.filteredItems[this.selectedIndex];
        if (selectedItem && this.onSelect) {
          this.onSelect(selectedItem);
        }
      } else if (kb.matches(keyData, "tui.select.cancel")) {
        if (this.onCancel) {
          this.onCancel();
        }
      }
    }
    getVisibleRange() {
      const startIndex = Math.max(
        0,
        Math.min(this.windowStart, Math.max(0, this.filteredItems.length - this.maxVisible))
      );
      return {
        startIndex,
        endIndex: Math.min(startIndex + this.maxVisible, this.filteredItems.length)
      };
    }
    /**
     * Center the window on the selection. Keyboard navigation calls this so
     * the selection stays in view; a hover does not, so the row under the
     * pointer stays under the pointer.
     */
    scrollToSelection() {
      this.windowStart = Math.max(
        0,
        Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible)
      );
    }
    renderItem(item, isSelected, width, descriptionSingleLine, primaryColumnWidth) {
      const prefix = isSelected ? "\u2192 " : "  ";
      const prefixWidth = visibleWidth(prefix);
      if (descriptionSingleLine && width > 40) {
        const effectivePrimaryColumnWidth = Math.max(1, Math.min(primaryColumnWidth, width - prefixWidth - 4));
        const maxPrimaryWidth = Math.max(1, effectivePrimaryColumnWidth - PRIMARY_COLUMN_GAP);
        const truncatedValue2 = this.truncatePrimary(item, isSelected, maxPrimaryWidth, effectivePrimaryColumnWidth);
        const truncatedValueWidth = visibleWidth(truncatedValue2);
        const spacing = " ".repeat(Math.max(1, effectivePrimaryColumnWidth - truncatedValueWidth));
        const descriptionStart = prefixWidth + truncatedValueWidth + spacing.length;
        const remainingWidth = width - descriptionStart - 2;
        if (remainingWidth > MIN_DESCRIPTION_WIDTH) {
          const truncatedDesc = truncateToWidth(descriptionSingleLine, remainingWidth, "");
          if (isSelected) {
            return this.theme.selectedText(`${prefix}${truncatedValue2}${spacing}${truncatedDesc}`);
          }
          const descText = this.theme.description(spacing + truncatedDesc);
          return prefix + truncatedValue2 + descText;
        }
      }
      const maxWidth = width - prefixWidth - 2;
      const truncatedValue = this.truncatePrimary(item, isSelected, maxWidth, maxWidth);
      if (isSelected) {
        return this.theme.selectedText(`${prefix}${truncatedValue}`);
      }
      return prefix + truncatedValue;
    }
    getPrimaryColumnWidth() {
      const { min, max } = this.getPrimaryColumnBounds();
      const widestPrimary = this.filteredItems.reduce((widest, item) => {
        return Math.max(widest, visibleWidth(this.getDisplayValue(item)) + PRIMARY_COLUMN_GAP);
      }, 0);
      return clamp(widestPrimary, min, max);
    }
    getPrimaryColumnBounds() {
      const rawMin = this.layout.minPrimaryColumnWidth ?? this.layout.maxPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
      const rawMax = this.layout.maxPrimaryColumnWidth ?? this.layout.minPrimaryColumnWidth ?? DEFAULT_PRIMARY_COLUMN_WIDTH;
      return {
        min: Math.max(1, Math.min(rawMin, rawMax)),
        max: Math.max(1, Math.max(rawMin, rawMax))
      };
    }
    truncatePrimary(item, isSelected, maxWidth, columnWidth) {
      const displayValue = this.getDisplayValue(item);
      const truncatedValue = this.layout.truncatePrimary ? this.layout.truncatePrimary({
        text: displayValue,
        maxWidth,
        columnWidth,
        item,
        isSelected
      }) : truncateToWidth(displayValue, maxWidth, "");
      return truncateToWidth(truncatedValue, maxWidth, "");
    }
    getDisplayValue(item) {
      return item.label || item.value;
    }
    notifySelectionChange() {
      const selectedItem = this.filteredItems[this.selectedIndex];
      if (selectedItem && this.onSelectionChange) {
        this.onSelectionChange(selectedItem);
      }
    }
    getSelectedItem() {
      const item = this.filteredItems[this.selectedIndex];
      return item || null;
    }
  };


  function fuzzyMatch(query, text) {
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();
    const matchQuery = (normalizedQuery) => {
      if (normalizedQuery.length === 0) {
        return { matches: true, score: 0 };
      }
      if (normalizedQuery.length > textLower.length) {
        return { matches: false, score: 0 };
      }
      let queryIndex = 0;
      let score = 0;
      let lastMatchIndex = -1;
      let consecutiveMatches = 0;
      while (queryIndex < normalizedQuery.length) {
        const i = textLower.indexOf(normalizedQuery[queryIndex], lastMatchIndex + 1);
        if (i === -1) break;
        const isWordBoundary = i === 0 || /[\s\-_./:]/.test(textLower[i - 1]);
        if (lastMatchIndex === i - 1) {
          consecutiveMatches++;
          score -= consecutiveMatches * 5;
        } else {
          consecutiveMatches = 0;
          if (lastMatchIndex >= 0) {
            score += (i - lastMatchIndex - 1) * 2;
          }
        }
        if (isWordBoundary) {
          score -= 10;
        }
        score += i * 0.1;
        lastMatchIndex = i;
        queryIndex++;
      }
      if (queryIndex < normalizedQuery.length) {
        return { matches: false, score: 0 };
      }
      if (normalizedQuery === textLower) {
        score -= 100;
      }
      return { matches: true, score };
    };
    const primaryMatch = matchQuery(queryLower);
    if (primaryMatch.matches) {
      return primaryMatch;
    }
    const alphaNumericMatch = queryLower.match(/^(?<letters>[a-z]+)(?<digits>[0-9]+)$/);
    const numericAlphaMatch = queryLower.match(/^(?<digits>[0-9]+)(?<letters>[a-z]+)$/);
    const swappedQuery = alphaNumericMatch ? `${alphaNumericMatch.groups?.digits ?? ""}${alphaNumericMatch.groups?.letters ?? ""}` : numericAlphaMatch ? `${numericAlphaMatch.groups?.letters ?? ""}${numericAlphaMatch.groups?.digits ?? ""}` : "";
    if (!swappedQuery) {
      return primaryMatch;
    }
    const swappedMatch = matchQuery(swappedQuery);
    if (!swappedMatch.matches) {
      return primaryMatch;
    }
    return { matches: true, score: swappedMatch.score + 5 };
  }
  function fuzzyFilter(items, query, getText) {
    if (!query.trim()) {
      return items;
    }
    const tokens = query.trim().split(/[\s/]+/).filter((t) => t.length > 0);
    if (tokens.length === 0) {
      return items;
    }
    const results = [];
    for (const item of items) {
      const text = getText(item);
      let totalScore = 0;
      let allMatch = true;
      for (const token of tokens) {
        const match2 = fuzzyMatch(token, text);
        if (match2.matches) {
          totalScore += match2.score;
        } else {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        results.push({ item, totalScore });
      }
    }
    results.sort((a, b) => a.totalScore - b.totalScore);
    return results.map((r) => r.item);
  }


  var compile_exports = {};
  __export(compile_exports, {
    Code: () => Code,
    Compile: () => Compile,
    Validator: () => Validator,
    default: () => compile_default
  });


  function IsRefine2(value) {
    return guard_exports.HasPropertyKey(value, "~refine") && guard_exports.IsArray(value["~refine"]) && guard_exports.Every(value["~refine"], 0, (value2) => guard_exports.IsObject(value2) && guard_exports.HasPropertyKey(value2, "check") && guard_exports.HasPropertyKey(value2, "error") && guard_exports.IsFunction(value2.check) && guard_exports.IsFunction(value2.error));
  }


  function IsSchemaObject2(value) {
    return guard_exports.IsObject(value) && !guard_exports.IsArray(value);
  }
  function IsSchemaBoolean(value) {
    return guard_exports.IsBoolean(value);
  }
  function IsSchema2(value) {
    return IsSchemaObject2(value) || IsSchemaBoolean(value);
  }


  function IsAdditionalItems(schema) {
    return guard_exports.HasPropertyKey(schema, "additionalItems") && IsSchema2(schema.additionalItems);
  }


  function IsAdditionalProperties(schema) {
    return guard_exports.HasPropertyKey(schema, "additionalProperties") && IsSchema2(schema.additionalProperties);
  }


  function IsAllOf(schema) {
    return guard_exports.HasPropertyKey(schema, "allOf") && guard_exports.IsArray(schema.allOf) && schema.allOf.every((value) => IsSchema2(value));
  }


  function IsAnchor(schema) {
    return guard_exports.HasPropertyKey(schema, "$anchor") && guard_exports.IsString(schema.$anchor);
  }


  function IsAnyOf(schema) {
    return guard_exports.HasPropertyKey(schema, "anyOf") && guard_exports.IsArray(schema.anyOf) && schema.anyOf.every((value) => IsSchema2(value));
  }


  function IsConst(value) {
    return guard_exports.HasPropertyKey(value, "const");
  }


  function IsContains(schema) {
    return guard_exports.HasPropertyKey(schema, "contains") && IsSchema2(schema.contains);
  }


  function IsDefault(schema) {
    return guard_exports.HasPropertyKey(schema, "default");
  }


  function IsDependencies(schema) {
    return guard_exports.HasPropertyKey(schema, "dependencies") && guard_exports.IsObject(schema.dependencies) && Object.values(schema.dependencies).every((value) => IsSchema2(value) || guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
  }


  function IsDependentRequired(schema) {
    return guard_exports.HasPropertyKey(schema, "dependentRequired") && guard_exports.IsObject(schema.dependentRequired) && Object.values(schema.dependentRequired).every((value) => guard_exports.IsArray(value) && value.every((value2) => guard_exports.IsString(value2)));
  }


  function IsDependentSchemas(schema) {
    return guard_exports.HasPropertyKey(schema, "dependentSchemas") && guard_exports.IsObject(schema.dependentSchemas) && Object.values(schema.dependentSchemas).every((value) => IsSchema2(value));
  }


  function IsDynamicAnchor(schema) {
    return guard_exports.HasPropertyKey(schema, "$dynamicAnchor") && guard_exports.IsString(schema.$dynamicAnchor);
  }


  function IsDynamicRef(schema) {
    return guard_exports.HasPropertyKey(schema, "$dynamicRef") && guard_exports.IsString(schema.$dynamicRef);
  }


  function IsElse(schema) {
    return guard_exports.HasPropertyKey(schema, "else") && IsSchema2(schema.else);
  }


  function IsEnum2(schema) {
    return guard_exports.HasPropertyKey(schema, "enum") && guard_exports.IsArray(schema.enum);
  }


  function IsExclusiveMaximum(schema) {
    return guard_exports.HasPropertyKey(schema, "exclusiveMaximum") && (guard_exports.IsNumber(schema.exclusiveMaximum) || guard_exports.IsBigInt(schema.exclusiveMaximum));
  }


  function IsExclusiveMinimum(schema) {
    return guard_exports.HasPropertyKey(schema, "exclusiveMinimum") && (guard_exports.IsNumber(schema.exclusiveMinimum) || guard_exports.IsBigInt(schema.exclusiveMinimum));
  }


  function IsFormat(schema) {
    return guard_exports.HasPropertyKey(schema, "format") && guard_exports.IsString(schema.format);
  }


  function IsId(schema) {
    return guard_exports.HasPropertyKey(schema, "$id") && guard_exports.IsString(schema.$id);
  }


  function IsIf(schema) {
    return guard_exports.HasPropertyKey(schema, "if") && IsSchema2(schema.if);
  }


  function IsItems(schema) {
    return guard_exports.HasPropertyKey(schema, "items") && (IsSchema2(schema.items) || guard_exports.IsArray(schema.items) && schema.items.every((value) => {
      return IsSchema2(value);
    }));
  }
  function IsItemsSized(schema) {
    return IsItems(schema) && guard_exports.IsArray(schema.items);
  }


  function IsMaximum(schema) {
    return guard_exports.HasPropertyKey(schema, "maximum") && (guard_exports.IsNumber(schema.maximum) || guard_exports.IsBigInt(schema.maximum));
  }


  function IsMaxContains(schema) {
    return guard_exports.HasPropertyKey(schema, "maxContains") && guard_exports.IsNumber(schema.maxContains);
  }


  function IsMaxItems(schema) {
    return guard_exports.HasPropertyKey(schema, "maxItems") && guard_exports.IsNumber(schema.maxItems);
  }


  function IsMaxLength4(schema) {
    return guard_exports.HasPropertyKey(schema, "maxLength") && guard_exports.IsNumber(schema.maxLength);
  }


  function IsMaxProperties(schema) {
    return guard_exports.HasPropertyKey(schema, "maxProperties") && guard_exports.IsNumber(schema.maxProperties);
  }


  function IsMinimum(schema) {
    return guard_exports.HasPropertyKey(schema, "minimum") && (guard_exports.IsNumber(schema.minimum) || guard_exports.IsBigInt(schema.minimum));
  }


  function IsMinContains(schema) {
    return guard_exports.HasPropertyKey(schema, "minContains") && guard_exports.IsNumber(schema.minContains);
  }


  function IsMinItems(schema) {
    return guard_exports.HasPropertyKey(schema, "minItems") && guard_exports.IsNumber(schema.minItems);
  }


  function IsMinLength4(schema) {
    return guard_exports.HasPropertyKey(schema, "minLength") && guard_exports.IsNumber(schema.minLength);
  }


  function IsMinProperties(schema) {
    return guard_exports.HasPropertyKey(schema, "minProperties") && guard_exports.IsNumber(schema.minProperties);
  }


  function IsMultipleOf2(schema) {
    return guard_exports.HasPropertyKey(schema, "multipleOf") && (guard_exports.IsNumber(schema.multipleOf) || guard_exports.IsBigInt(schema.multipleOf));
  }


  function IsNot(schema) {
    return guard_exports.HasPropertyKey(schema, "not") && IsSchema2(schema.not);
  }


  function IsOneOf(schema) {
    return guard_exports.HasPropertyKey(schema, "oneOf") && guard_exports.IsArray(schema.oneOf) && schema.oneOf.every((value) => IsSchema2(value));
  }


  function IsPattern(schema) {
    return guard_exports.HasPropertyKey(schema, "pattern") && (guard_exports.IsString(schema.pattern) || schema.pattern instanceof RegExp);
  }


  function IsPatternProperties(schema) {
    return guard_exports.HasPropertyKey(schema, "patternProperties") && guard_exports.IsObject(schema.patternProperties) && Object.values(schema.patternProperties).every((value) => IsSchema2(value));
  }


  function IsPrefixItems(schema) {
    return guard_exports.HasPropertyKey(schema, "prefixItems") && guard_exports.IsArray(schema.prefixItems) && schema.prefixItems.every((schema2) => IsSchema2(schema2));
  }


  function IsProperties(schema) {
    return guard_exports.HasPropertyKey(schema, "properties") && guard_exports.IsObject(schema.properties) && Object.values(schema.properties).every((value) => IsSchema2(value));
  }


  function IsPropertyNames(schema) {
    return guard_exports.HasPropertyKey(schema, "propertyNames") && (guard_exports.IsObject(schema.propertyNames) || IsSchema2(schema.propertyNames));
  }


  function IsRecursiveAnchor(schema) {
    return guard_exports.HasPropertyKey(schema, "$recursiveAnchor") && guard_exports.IsBoolean(schema.$recursiveAnchor);
  }
  function IsRecursiveAnchorTrue(schema) {
    return IsRecursiveAnchor(schema) && guard_exports.IsEqual(schema.$recursiveAnchor, true);
  }


  function IsRecursiveRef(schema) {
    return guard_exports.HasPropertyKey(schema, "$recursiveRef") && guard_exports.IsString(schema.$recursiveRef);
  }


  function IsRef2(schema) {
    return guard_exports.HasPropertyKey(schema, "$ref") && guard_exports.IsString(schema.$ref);
  }


  function IsRequired(schema) {
    return guard_exports.HasPropertyKey(schema, "required") && guard_exports.IsArray(schema.required) && schema.required.every((value) => guard_exports.IsString(value));
  }


  function IsThen(schema) {
    return guard_exports.HasPropertyKey(schema, "then") && IsSchema2(schema.then);
  }


  function IsType(schema) {
    return guard_exports.HasPropertyKey(schema, "type") && (guard_exports.IsString(schema.type) || guard_exports.IsArray(schema.type) && schema.type.every((value) => guard_exports.IsString(value)));
  }


  function IsUniqueItems(schema) {
    return guard_exports.HasPropertyKey(schema, "uniqueItems") && guard_exports.IsBoolean(schema.uniqueItems);
  }


  function IsUnevaluatedItems(schema) {
    return guard_exports.HasPropertyKey(schema, "unevaluatedItems") && IsSchema2(schema.unevaluatedItems);
  }


  function IsUnevaluatedProperties(schema) {
    return guard_exports.HasPropertyKey(schema, "unevaluatedProperties") && IsSchema2(schema.unevaluatedProperties);
  }


  function HasUnevaluatedFromObject(value) {
    return IsUnevaluatedItems(value) || IsUnevaluatedProperties(value) || guard_exports.Some(guard_exports.Keys(value), (key) => HasUnevaluatedFromUnknown(value[key]));
  }
  function HasUnevaluatedFromArray(value) {
    return guard_exports.Some(value, (value2) => HasUnevaluatedFromUnknown(value2));
  }
  function HasUnevaluatedFromUnknown(value) {
    return guard_exports.IsArray(value) ? HasUnevaluatedFromArray(value) : guard_exports.IsObject(value) ? HasUnevaluatedFromObject(value) : false;
  }
  function HasUnevaluated(context, schema) {
    return HasUnevaluatedFromUnknown(schema) || guard_exports.Some(guard_exports.Keys(context), (key) => HasUnevaluatedFromUnknown(context[key]));
  }
  var BuildContext = class {
    constructor(hasUnevaluated) {
      this.hasUnevaluated = hasUnevaluated;
    }
    UseUnevaluated() {
      return this.hasUnevaluated;
    }
    // ----------------------------------------------------------------
    // Stack
    // ----------------------------------------------------------------
    Push() {
      return emit_exports.Call(emit_exports.Member("context", "Push"), []);
    }
    Pop() {
      return emit_exports.Call(emit_exports.Member("context", "Pop"), []);
    }
    // ----------------------------------------------------------------
    // Top
    // ----------------------------------------------------------------
    AddIndex(index3) {
      return emit_exports.Call(emit_exports.Member("context", "AddIndex"), [index3]);
    }
    AddKey(key) {
      return emit_exports.Call(emit_exports.Member("context", "AddKey"), [key]);
    }
    Merge(results) {
      return emit_exports.Call(emit_exports.Member("context", "Merge"), [results]);
    }
  };
  var CheckContext = class {
    constructor() {
      const indices = /* @__PURE__ */ new Set();
      const keys = /* @__PURE__ */ new Set();
      this.stack = [{ indices, keys }];
    }
    // ----------------------------------------------------------------
    // Stack
    // ----------------------------------------------------------------
    Push() {
      const indices = /* @__PURE__ */ new Set();
      const keys = /* @__PURE__ */ new Set();
      this.stack.push({ indices, keys });
      return true;
    }
    Pop() {
      this.stack.pop();
      return true;
    }
    // ----------------------------------------------------------------
    // Top
    // ----------------------------------------------------------------
    AddIndex(index3) {
      this.GetIndices().add(index3);
      return true;
    }
    AddKey(key) {
      this.GetKeys().add(key);
      return true;
    }
    GetIndices() {
      const top = this.stack[this.stack.length - 1];
      return top.indices;
    }
    GetKeys() {
      const top = this.stack[this.stack.length - 1];
      return top.keys;
    }
    Merge(results) {
      for (const context of results) {
        context.GetIndices().forEach((value) => this.GetIndices().add(value));
        context.GetKeys().forEach((value) => this.GetKeys().add(value));
      }
      return true;
    }
  };
  var ErrorContext = class extends CheckContext {
    constructor() {
      super();
      this.errors = [];
    }
    AtCapacity() {
      return this.errors.length >= settings_exports.Get().maxErrors;
    }
    AddError(error2) {
      if (!this.AtCapacity())
        this.errors.push(error2);
      return false;
    }
    GetErrors() {
      return this.errors;
    }
  };


  var state = {
    identifier: "External",
    variables: []
  };
  function CreateVariable(value) {
    const call = `External[${state.variables.length}]`;
    state.variables.push(value);
    return call;
  }
  function ResetExternal() {
    state.variables = [];
  }
  function GetExternal() {
    return { ...state };
  }


  function BuildRefine(_stack, _context, schema, value) {
    const refinements = CreateVariable(schema["~refine"].map((refinement) => refinement));
    return emit_exports.Every(refinements, emit_exports.Constant(0), ["refinement", "_"], emit_exports.Call(emit_exports.Member("refinement", "check"), [value]));
  }
  function CheckRefine(_stack, _context, schema, value) {
    return guard_exports.Every(schema["~refine"], 0, (refinement, _) => refinement.check(value));
  }
  function ErrorRefine(_stack, context, schemaPath, instancePath, schema, value) {
    return guard_exports.EveryAll(schema["~refine"], 0, (refinement, index3) => {
      return refinement.check(value) || context.AddError({
        keyword: "~refine",
        schemaPath,
        instancePath,
        params: { index: index3, message: refinement.error(value) }
      });
    });
  }


  var index = 0;
  function Unique() {
    return `var_${index++}`;
  }


  function IsValid(schema) {
    return IsItems(schema) && guard_exports.IsArray(schema.items);
  }
  function BuildAdditionalItemsStandard(stack, context, schema, value) {
    const [item, index3] = [Unique(), Unique()];
    const isSchema = BuildSchemaPushStack(stack, context, schema.additionalItems, item);
    const isLength = emit_exports.IsLessThan(index3, emit_exports.Constant(schema.items.length));
    const addIndex = context.AddIndex(index3);
    return emit_exports.Every(value, emit_exports.Constant(0), [item, index3], emit_exports.Or(isLength, emit_exports.And(isSchema, addIndex)));
  }
  function BuildAdditionalItemsFast(stack, context, schema, value) {
    const [item, index3] = [Unique(), Unique()];
    const isSchema = BuildSchemaPushStack(stack, context, schema.additionalItems, item);
    const isLength = emit_exports.IsLessThan(index3, emit_exports.Constant(schema.items.length));
    return emit_exports.Every(value, emit_exports.Constant(0), [item, index3], emit_exports.Or(isLength, isSchema));
  }
  function BuildAdditionalItems(stack, context, schema, value) {
    if (!IsValid(schema))
      return emit_exports.Constant(true);
    return context.UseUnevaluated() ? BuildAdditionalItemsStandard(stack, context, schema, value) : BuildAdditionalItemsFast(stack, context, schema, value);
  }
  function CheckAdditionalItems(stack, context, schema, value) {
    if (!IsValid(schema))
      return true;
    const isAdditionalItems = guard_exports.Every(value, 0, (item, index3) => {
      return guard_exports.IsLessThan(index3, schema.items.length) || CheckSchemaPushStack(stack, context, schema.additionalItems, item) && context.AddIndex(index3);
    });
    return isAdditionalItems;
  }
  function ErrorAdditionalItems(stack, context, schemaPath, instancePath, schema, value) {
    if (!IsValid(schema))
      return true;
    const isAdditionalItems = guard_exports.Every(value, 0, (item, index3) => {
      const nextSchemaPath = `${schemaPath}/additionalItems`;
      const nextInstancePath = `${instancePath}/${index3}`;
      return guard_exports.IsLessThan(index3, schema.items.length) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.additionalItems, item) && context.AddIndex(index3);
    });
    return isAdditionalItems;
  }


  function UnicodeRegExp(pattern) {
    return new RegExp(pattern, "u");
  }


  function IsAdditionalPropertiesIgnored(context, additionalProperties) {
    return !context.UseUnevaluated() && (guard_exports.IsEqual(additionalProperties, true) || guard_exports.IsObject(additionalProperties) && guard_exports.IsEqual(guard_exports.Keys(additionalProperties).length, 0));
  }
  function GetPropertyKeyAsPattern(key) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return `^${escaped}$`;
  }
  function GetPropertiesPattern(schema) {
    const patterns = [];
    if (IsPatternProperties(schema))
      patterns.push(...guard_exports.Keys(schema.patternProperties));
    if (IsProperties(schema))
      patterns.push(...guard_exports.Keys(schema.properties).map(GetPropertyKeyAsPattern));
    return guard_exports.IsEqual(patterns.length, 0) ? "(?!)" : `(${patterns.join("|")})`;
  }
  function CanAdditionalPropertiesFast(_context, schema, _value) {
    return IsRequired(schema) && IsProperties(schema) && !IsPatternProperties(schema) && guard_exports.IsEqual(schema.additionalProperties, false) && guard_exports.IsEqual(guard_exports.Keys(schema.properties).length, schema.required.length);
  }
  function BuildAdditionalPropertiesFast(_context, schema, value) {
    return emit_exports.IsEqual(emit_exports.Member(emit_exports.Call(emit_exports.Member("Object", "getOwnPropertyNames"), [value]), "length"), emit_exports.Constant(schema.required.length));
  }
  function BuildAdditionalPropertiesStandard(stack, context, schema, value) {
    const [key, _index] = [Unique(), Unique()];
    const regexp = CreateVariable(UnicodeRegExp(GetPropertiesPattern(schema)));
    const isSchema = BuildSchemaPushStack(stack, context, schema.additionalProperties, `${value}[${key}]`);
    const isKey = emit_exports.Call(emit_exports.Member(regexp, "test"), [key]);
    const addKey = context.AddKey(key);
    const guarded = context.UseUnevaluated() ? emit_exports.Or(isKey, emit_exports.And(isSchema, addKey)) : emit_exports.Or(isKey, isSchema);
    const result = emit_exports.Every(emit_exports.Keys(value), emit_exports.Constant(0), [key, _index], guarded);
    return result;
  }
  function BuildAdditionalProperties(stack, context, schema, value) {
    if (IsAdditionalPropertiesIgnored(context, schema.additionalProperties))
      return emit_exports.Constant(true);
    return CanAdditionalPropertiesFast(context, schema, value) ? BuildAdditionalPropertiesFast(context, schema, value) : BuildAdditionalPropertiesStandard(stack, context, schema, value);
  }
  function CheckAdditionalProperties(stack, context, schema, value) {
    const regexp = UnicodeRegExp(GetPropertiesPattern(schema));
    const isAdditionalProperties = guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => {
      return regexp.test(key) || CheckSchemaPushStack(stack, context, schema.additionalProperties, value[key]) && context.AddKey(key);
    });
    return isAdditionalProperties;
  }
  function ErrorAdditionalProperties(stack, context, schemaPath, instancePath, schema, value) {
    const regexp = UnicodeRegExp(GetPropertiesPattern(schema));
    const additionalProperties = [];
    const isAdditionalProperties = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
      const nextSchemaPath = `${schemaPath}/additionalProperties`;
      const nextInstancePath = `${instancePath}/${key}`;
      const isAdditionalProperty = regexp.test(key) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.additionalProperties, value[key]) && context.AddKey(key);
      if (!isAdditionalProperty)
        additionalProperties.push(key);
      return isAdditionalProperty;
    });
    return isAdditionalProperties || context.AddError({
      keyword: "additionalProperties",
      schemaPath,
      instancePath,
      params: { additionalProperties }
    });
  }


  function Reducer(stack, context, schemas, value, check) {
    const results = emit_exports.ConstDeclaration("results", "[]");
    const context_n = schemas.map((_schema, index3) => emit_exports.ConstDeclaration(`context_${index3}`, emit_exports.New("CheckContext", [])));
    const condition_n = schemas.map((schema, index3) => emit_exports.ConstDeclaration(`condition_${index3}`, emit_exports.Call(emit_exports.ArrowFunction(["context"], BuildSchema(stack, context, schema, value)), [`context_${index3}`])));
    const checks = schemas.map((_schema, index3) => emit_exports.If(`condition_${index3}`, emit_exports.Call(emit_exports.Member("results", "push"), [`context_${index3}`])));
    const returns = emit_exports.Return(emit_exports.And(check, context.Merge("results")));
    return emit_exports.Call(emit_exports.ArrowFunction([], emit_exports.Statements([results, ...context_n, ...condition_n, ...checks, returns])), []);
  }


  function BuildAllOfStandard(stack, context, schema, value) {
    return Reducer(stack, context, schema.allOf, value, emit_exports.IsEqual(emit_exports.Member("results", "length"), emit_exports.Constant(schema.allOf.length)));
  }
  function BuildAllOfFast(stack, context, schema, value) {
    return emit_exports.ReduceAnd(schema.allOf.map((schema2) => BuildSchema(stack, context, schema2, value)));
  }
  function BuildAllOf(stack, context, schema, value) {
    return context.UseUnevaluated() ? BuildAllOfStandard(stack, context, schema, value) : BuildAllOfFast(stack, context, schema, value);
  }
  function CheckAllOf(stack, context, schema, value) {
    const results = schema.allOf.reduce((result, schema2) => {
      const nextContext = new CheckContext();
      return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
    }, []);
    return guard_exports.IsEqual(results.length, schema.allOf.length) && context.Merge(results);
  }
  function ErrorAllOf(stack, context, schemaPath, instancePath, schema, value) {
    const failedContexts = [];
    const results = schema.allOf.reduce((result, schema2, index3) => {
      const nextSchemaPath = `${schemaPath}/allOf/${index3}`;
      const nextContext = new ErrorContext();
      const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
      if (!isSchema)
        failedContexts.push(nextContext);
      return isSchema ? [...result, nextContext] : result;
    }, []);
    const isAllOf = guard_exports.IsEqual(results.length, schema.allOf.length) && context.Merge(results);
    if (!isAllOf)
      failedContexts.forEach((failed) => failed.GetErrors().forEach((error2) => context.AddError(error2)));
    return isAllOf;
  }


  function BuildAnyOfStandard(stack, context, schema, value) {
    return Reducer(stack, context, schema.anyOf, value, emit_exports.IsGreaterThan(emit_exports.Member("results", "length"), emit_exports.Constant(0)));
  }
  function BuildAnyOfFast(stack, context, schema, value) {
    return emit_exports.ReduceOr(schema.anyOf.map((schema2) => BuildSchema(stack, context, schema2, value)));
  }
  function BuildAnyOf(stack, context, schema, value) {
    return context.UseUnevaluated() ? BuildAnyOfStandard(stack, context, schema, value) : BuildAnyOfFast(stack, context, schema, value);
  }
  function CheckAnyOf(stack, context, schema, value) {
    const results = schema.anyOf.reduce((result, schema2) => {
      const nextContext = new CheckContext();
      return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
    }, []);
    return guard_exports.IsGreaterThan(results.length, 0) && context.Merge(results);
  }
  function ErrorAnyOf(stack, context, schemaPath, instancePath, schema, value) {
    const failedContexts = [];
    const results = schema.anyOf.reduce((result, schema2, index3) => {
      const nextContext = new ErrorContext();
      const nextSchemaPath = `${schemaPath}/anyOf/${index3}`;
      const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
      if (!isSchema)
        failedContexts.push(nextContext);
      return isSchema ? [...result, nextContext] : result;
    }, []);
    const isAnyOf = guard_exports.IsGreaterThan(results.length, 0) && context.Merge(results);
    if (!isAnyOf)
      failedContexts.forEach((failed) => failed.GetErrors().forEach((error2) => context.AddError(error2)));
    return isAnyOf || context.AddError({
      keyword: "anyOf",
      schemaPath,
      instancePath,
      params: {}
    });
  }


  function BuildSchemaBoolean(_stack, _context, schema, _value) {
    return schema ? emit_exports.Constant(true) : emit_exports.Constant(false);
  }
  function CheckSchemaBoolean(_stack, _context, schema, _value) {
    return schema;
  }
  function ErrorSchemaBoolean(stack, context, schemaPath, instancePath, schema, value) {
    return CheckSchemaBoolean(stack, context, schema, value) || context.AddError({
      keyword: "boolean",
      schemaPath,
      instancePath,
      params: {}
    });
  }


  function BuildConst(_stack, _context, schema, value) {
    return guard_exports.IsValueLike(schema.const) ? emit_exports.IsEqual(value, emit_exports.Constant(schema.const)) : emit_exports.IsDeepEqual(value, CreateVariable(schema.const));
  }
  function CheckConst(_stack, _context, schema, value) {
    return guard_exports.IsValueLike(schema.const) ? guard_exports.IsEqual(value, schema.const) : guard_exports.IsDeepEqual(value, schema.const);
  }
  function ErrorConst(stack, context, schemaPath, instancePath, schema, value) {
    return CheckConst(stack, context, schema, value) || context.AddError({
      keyword: "const",
      schemaPath,
      instancePath,
      params: { allowedValue: schema.const }
    });
  }


  function IsValid2(schema) {
    return !(IsMinContains(schema) && guard_exports.IsEqual(schema.minContains, 0));
  }
  function BuildContainsStandard(stack, context, schema, value) {
    const [item, index3] = [Unique(), Unique()];
    const isLength = emit_exports.Not(emit_exports.IsEqual(emit_exports.Member(value, "length"), emit_exports.Constant(0)));
    const isSome = emit_exports.SomeAll(value, [item, index3], emit_exports.And(BuildSchema(stack, context, schema.contains, item), context.AddIndex(index3)));
    return emit_exports.And(isLength, isSome);
  }
  function BuildContainsFast(stack, context, schema, value) {
    const [item] = [Unique()];
    const isLength = emit_exports.Not(emit_exports.IsEqual(emit_exports.Member(value, "length"), emit_exports.Constant(0)));
    const isSome = emit_exports.Some(value, [item, "_"], BuildSchema(stack, context, schema.contains, item));
    return emit_exports.And(isLength, isSome);
  }
  function BuildContains(stack, context, schema, value) {
    if (!IsValid2(schema))
      return emit_exports.Constant(true);
    return context.UseUnevaluated() ? BuildContainsStandard(stack, context, schema, value) : BuildContainsFast(stack, context, schema, value);
  }
  function CheckContains(stack, context, schema, value) {
    if (!IsValid2(schema))
      return true;
    return !guard_exports.IsEqual(value.length, 0) && guard_exports.SomeAll(value, (item, index3) => {
      return CheckSchema(stack, context, schema.contains, item) && context.AddIndex(index3);
    });
  }
  function ErrorContains(stack, context, schemaPath, instancePath, schema, value) {
    return CheckContains(stack, context, schema, value) || context.AddError({
      keyword: "contains",
      schemaPath,
      instancePath,
      params: { minContains: 1 }
    });
  }


  function BuildDependencies(stack, context, schema, value) {
    const isLength = emit_exports.IsEqual(emit_exports.Member(emit_exports.Keys(value), "length"), emit_exports.Constant(0));
    const isEveryDependency = emit_exports.ReduceAnd(guard_exports.Entries(schema.dependencies).map(([key, schema2]) => {
      const notKey = emit_exports.Not(emit_exports.HasPropertyKey(value, emit_exports.Constant(key)));
      const isSchema = BuildSchema(stack, context, schema2, value);
      const isEveryKey = (schema3) => emit_exports.ReduceAnd(schema3.map((key2) => emit_exports.HasPropertyKey(value, emit_exports.Constant(key2))));
      return emit_exports.Or(notKey, guard_exports.IsArray(schema2) ? isEveryKey(schema2) : isSchema);
    }));
    return emit_exports.Or(isLength, isEveryDependency);
  }
  function CheckDependencies(stack, context, schema, value) {
    const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
    const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
      return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((key2) => guard_exports.HasPropertyKey(value, key2)) : CheckSchema(stack, context, schema2, value));
    });
    return isLength || isEvery;
  }
  function ErrorDependencies(stack, context, schemaPath, instancePath, schema, value) {
    const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
    const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependencies), 0, ([key, schema2]) => {
      const nextSchemaPath = `${schemaPath}/dependencies/${key}`;
      return !guard_exports.HasPropertyKey(value, key) || (guard_exports.IsArray(schema2) ? schema2.every((dependency) => guard_exports.HasPropertyKey(value, dependency) || context.AddError({
        keyword: "dependencies",
        schemaPath,
        instancePath,
        params: { property: key, dependencies: schema2 }
      })) : ErrorSchema(stack, context, nextSchemaPath, instancePath, schema2, value));
    });
    return isLength || isEvery;
  }


  function BuildDependentRequired(_stack, _context, schema, value) {
    const isLength = emit_exports.IsEqual(emit_exports.Member(emit_exports.Keys(value), "length"), emit_exports.Constant(0));
    const isEvery = emit_exports.ReduceAnd(guard_exports.Entries(schema.dependentRequired).map(([key, keys]) => {
      const notKey = emit_exports.Not(emit_exports.HasPropertyKey(value, emit_exports.Constant(key)));
      const everyKey = emit_exports.ReduceAnd(keys.map((key2) => emit_exports.HasPropertyKey(value, emit_exports.Constant(key2))));
      return emit_exports.Or(notKey, everyKey);
    }));
    return emit_exports.Or(isLength, isEvery);
  }
  function CheckDependentRequired(_stack, _context, schema, value) {
    const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
    const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
      return !guard_exports.HasPropertyKey(value, key) || keys.every((key2) => guard_exports.HasPropertyKey(value, key2));
    });
    return isLength || isEvery;
  }
  function ErrorDependentRequired(_stack, context, schemaPath, instancePath, schema, value) {
    const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
    const isEveryEntry = guard_exports.EveryAll(guard_exports.Entries(schema.dependentRequired), 0, ([key, keys]) => {
      return !guard_exports.HasPropertyKey(value, key) || guard_exports.EveryAll(keys, 0, (dependency) => guard_exports.HasPropertyKey(value, dependency) || context.AddError({
        keyword: "dependentRequired",
        schemaPath,
        instancePath,
        params: { property: key, dependencies: keys }
      }));
    });
    return isLength || isEveryEntry;
  }


  function BuildDependentSchemas(stack, context, schema, value) {
    const isLength = emit_exports.IsEqual(emit_exports.Member(emit_exports.Keys(value), "length"), emit_exports.Constant(0));
    const isEvery = emit_exports.ReduceAnd(guard_exports.Entries(schema.dependentSchemas).map(([key, schema2]) => {
      const notKey = emit_exports.Not(emit_exports.HasPropertyKey(value, emit_exports.Constant(key)));
      const isSchema = BuildSchema(stack, context, schema2, value);
      return emit_exports.Or(notKey, isSchema);
    }));
    return emit_exports.Or(isLength, isEvery);
  }
  function CheckDependentSchemas(stack, context, schema, value) {
    const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
    const isEvery = guard_exports.Every(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
      return !guard_exports.HasPropertyKey(value, key) || CheckSchema(stack, context, schema2, value);
    });
    return isLength || isEvery;
  }
  function ErrorDependentSchemas(stack, context, schemaPath, instancePath, schema, value) {
    const isLength = guard_exports.IsEqual(guard_exports.Keys(value).length, 0);
    const isEvery = guard_exports.EveryAll(guard_exports.Entries(schema.dependentSchemas), 0, ([key, schema2]) => {
      const nextSchemaPath = `${schemaPath}/dependentSchemas/${key}`;
      return !guard_exports.HasPropertyKey(value, key) || ErrorSchema(stack, context, nextSchemaPath, instancePath, schema2, value);
    });
    return isLength || isEvery;
  }


  function BuildDynamicRef(stack, context, schema, value) {
    const target = stack.DynamicRef(schema) ?? false;
    return CreateFunction(stack, context, target, value);
  }
  function CheckDynamicRef(stack, context, schema, value) {
    const target = stack.DynamicRef(schema) ?? false;
    return IsSchema2(target) && CheckSchema(stack, context, target, value);
  }
  function ErrorDynamicRef(stack, context, _schemaPath, instancePath, schema, value) {
    const target = stack.DynamicRef(schema) ?? false;
    return IsSchema2(target) && ErrorSchema(stack, context, "#", instancePath, target, value);
  }


  function BuildEnum(_stack, _context, schema, value) {
    return emit_exports.ReduceOr(schema.enum.map((option) => {
      if (guard_exports.IsValueLike(option))
        return emit_exports.IsEqual(value, emit_exports.Constant(option));
      const variable = CreateVariable(option);
      return emit_exports.IsDeepEqual(value, variable);
    }));
  }
  function CheckEnum(_stack, _context, schema, value) {
    return guard_exports.Some(schema.enum, (option) => guard_exports.IsValueLike(option) ? guard_exports.IsEqual(value, option) : guard_exports.IsDeepEqual(value, option));
  }
  function ErrorEnum(stack, context, schemaPath, instancePath, schema, value) {
    return CheckEnum(stack, context, schema, value) || context.AddError({
      keyword: "enum",
      schemaPath,
      instancePath,
      params: { allowedValues: schema.enum }
    });
  }


  function BuildExclusiveMaximum(_stack, _context, schema, value) {
    return emit_exports.IsLessThan(value, emit_exports.Constant(schema.exclusiveMaximum));
  }
  function CheckExclusiveMaximum(_stack, _context, schema, value) {
    return guard_exports.IsLessThan(value, schema.exclusiveMaximum);
  }
  function ErrorExclusiveMaximum(stack, context, schemaPath, instancePath, schema, value) {
    return CheckExclusiveMaximum(stack, context, schema, value) || context.AddError({
      keyword: "exclusiveMaximum",
      schemaPath,
      instancePath,
      params: { comparison: "<", limit: schema.exclusiveMaximum }
    });
  }


  function BuildExclusiveMinimum(_stack, _context, schema, value) {
    return emit_exports.IsGreaterThan(value, emit_exports.Constant(schema.exclusiveMinimum));
  }
  function CheckExclusiveMinimum(_stack, _context, schema, value) {
    return guard_exports.IsGreaterThan(value, schema.exclusiveMinimum);
  }
  function ErrorExclusiveMinimum(stack, context, schemaPath, instancePath, schema, value) {
    return CheckExclusiveMinimum(stack, context, schema, value) || context.AddError({
      keyword: "exclusiveMinimum",
      schemaPath,
      instancePath,
      params: { comparison: ">", limit: schema.exclusiveMinimum }
    });
  }


  var format_exports = {};
  __export(format_exports, {
    Clear: () => Clear,
    Entries: () => Entries3,
    Get: () => Get3,
    Has: () => Has,
    IsDate: () => IsDate2,
    IsDateTime: () => IsDateTime,
    IsDuration: () => IsDuration,
    IsEmail: () => IsEmail,
    IsHostname: () => IsHostname2,
    IsIPv4: () => IsIPv4,
    IsIPv6: () => IsIPv6,
    IsIdnEmail: () => IsIdnEmail,
    IsIdnHostname: () => IsIdnHostname2,
    IsIri: () => IsIri,
    IsIriReference: () => IsIriReference,
    IsJsonPointer: () => IsJsonPointer,
    IsJsonPointerUriFragment: () => IsJsonPointerUriFragment,
    IsRegex: () => IsRegex,
    IsRelativeJsonPointer: () => IsRelativeJsonPointer,
    IsTime: () => IsTime,
    IsUri: () => IsUri,
    IsUriReference: () => IsUriReference,
    IsUriTemplate: () => IsUriTemplate,
    IsUrl: () => IsUrl,
    IsUuid: () => IsUuid,
    Reset: () => Reset2,
    Set: () => Set3,
    Test: () => Test
  });


  var DAYS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var DATE = /^(\d\d\d\d)-(\d\d)-(\d\d)$/;
  function IsLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  function IsDate2(value) {
    const matches = DATE.exec(value);
    if (!matches)
      return false;
    const year = +matches[1];
    const month = +matches[2];
    const day = +matches[3];
    return month >= 1 && month <= 12 && day >= 1 && day <= (month === 2 && IsLeapYear(year) ? 29 : DAYS[month]);
  }


  var TIME = /^(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:([Zz])|([+-])(\d\d):(\d\d))?$/;
  function IsTime(value, strictTimeZone = true) {
    const matches = TIME.exec(value);
    if (!matches)
      return false;
    if (strictTimeZone && !matches[4] && !matches[5])
      return false;
    const hr = +matches[1];
    const min = +matches[2];
    const sec = +matches[3];
    if (hr > 23 || min > 59 || sec > 60)
      return false;
    if (matches[5]) {
      const tzH2 = +matches[6];
      const tzM2 = +matches[7];
      if (tzH2 > 23 || tzM2 > 59)
        return false;
    }
    if (sec < 60)
      return true;
    const tzSign = matches[5] === "-" ? -1 : 1;
    const tzH = +(matches[6] || 0);
    const tzM = +(matches[7] || 0);
    const totalUtcMin = hr * 60 + min - tzSign * (tzH * 60 + tzM);
    return (totalUtcMin % 1440 + 1440) % 1440 === 1439;
  }


  function IsDateTime(value) {
    const dateTime = value.split(/T/i);
    return dateTime.length === 2 && IsDate2(dateTime[0]) && IsTime(dateTime[1]);
  }


  var Duration = /^P((\d+Y(\d+M(\d+D)?)?|\d+M(\d+D)?|\d+D)(T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S))?|T(\d+H(\d+M(\d+S)?)?|\d+M(\d+S)?|\d+S)|\d+W)$/;
  function IsDuration(value) {
    return Duration.test(value);
  }


  var Email = /^(?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"(?:[^"\\]|\\[\x20-\x7e])*")@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[(?:IPv6:[a-f0-9:]+|(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])(?:\.(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])){3})\])$/i;
  function IsEmail(value) {
    return Email.test(value);
  }


  var RE_RULE_HYPHEN_PLACEMENT = /^(?!-).*(?<!-)$/;
  var RE_RULE_NOT_RESERVED_ACE = /^(?!..--)/;
  var RE_ASCII_LDH = /^[a-zA-Z0-9-]*$/;
  var RE_NON_ASCII = /[^\p{ASCII}]/u;
  var RE_ASCII_DIGIT = /[0-9]/;
  var RE_ARABIC_INDIC_DIGIT = /[\u{0660}-\u{0669}]/u;
  var RE_EXT_ARABIC_INDIC_DIGIT = /[\u{06f0}-\u{06f9}]/u;
  var RE_COMMON_SEPARATOR = /[\u{002e}\u{002c}\u{003a}\u{002f}]/u;
  var RE_EUROPEAN_SEPARATOR = /[\u{002d}\u{002b}]/u;
  var RE_MARK_NONSPACING = /\p{Mn}/u;
  var RE_MARK_SPACING_COMBINING = /\p{Mc}/u;
  var RE_COMBINING_MARK = /[\p{Mn}\p{Mc}\p{Me}]/u;
  var RE_LETTER = /\p{L}/u;
  var RE_NUMBER_DECIMAL = /\p{Nd}/u;
  var RE_SCRIPT_GREEK = /\p{Script=Greek}/u;
  var RE_SCRIPT_HEBREW = /\p{Script=Hebrew}/u;
  var RE_SCRIPT_JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
  var RE_SCRIPT_ARABIC_LETTER = /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Mandaic}]/u;
  var RE_VIRAMA = /[\u{094d}\u{09cd}\u{0a4d}\u{0acd}\u{0b4d}\u{0bcd}\u{0c4d}\u{0ccd}\u{0d3b}\u{0d3c}\u{0d4d}\u{0dca}\u{1b44}\u{1baa}\u{1bab}\u{a9c0}\u{11046}\u{1107f}\u{110b9}\u{11133}\u{11134}\u{111c0}\u{11235}\u{1134d}\u{11442}\u{114c2}\u{115bf}\u{1163f}\u{116b6}\u{11c3f}\u{11d44}\u{11d45}]/u;
  var RE_RFC5892_DISALLOWED = /[\u{0640}\u{07fa}\u{302e}\u{302f}\u{3031}\u{3032}\u{3033}\u{3034}\u{3035}\u{303b}]/u;
  var RE_CONTEXTO_EXCEPTIONS = /[\u{00b7}\u{0375}\u{05f3}\u{05f4}\u{200c}\u{200d}\u{30fb}]/u;
  var RE_PVALID_EXCEPTIONS = /[\u{00df}\u{03c2}\u{06fd}\u{06fe}\u{0f0b}\u{3007}]/u;
  var RE_EUROPEAN_NUMBER = new RegExp([
    RE_ASCII_DIGIT,
    RE_EXT_ARABIC_INDIC_DIGIT
  ].map((regexp) => regexp.source).join("|"), "u");
  var RE_PERMITTED_CATEGORY = new RegExp([
    RE_LETTER,
    RE_EUROPEAN_SEPARATOR,
    RE_COMMON_SEPARATOR,
    RE_NUMBER_DECIMAL,
    RE_MARK_NONSPACING,
    RE_MARK_SPACING_COMBINING,
    RE_CONTEXTO_EXCEPTIONS,
    RE_PVALID_EXCEPTIONS
  ].map((regexp) => regexp.source).join("|"), "u");


  function IsAsciiLabel(value) {
    return RE_RULE_HYPHEN_PLACEMENT.test(value) && RE_RULE_NOT_RESERVED_ACE.test(value) && RE_ASCII_LDH.test(value);
  }


  var PUNYCODE_BASE = 36;
  var PUNYCODE_TMIN = 1;
  var PUNYCODE_TMAX = 26;
  var PUNYCODE_SKEW = 38;
  var PUNYCODE_DAMP = 700;
  var PUNYCODE_INITIAL_BIAS = 72;
  var PUNYCODE_INITIAL_N = 128;
  function ThrowDontCare() {
    throw null;
  }
  function IsAcePrefixed(value) {
    return value.toLowerCase().startsWith("xn--");
  }
  function Adapt(delta, numPoints, firstTime) {
    delta = firstTime ? Math.floor(delta / PUNYCODE_DAMP) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > (PUNYCODE_BASE - PUNYCODE_TMIN) * PUNYCODE_TMAX >> 1) {
      delta = Math.floor(delta / (PUNYCODE_BASE - PUNYCODE_TMIN));
      k += PUNYCODE_BASE;
    }
    return k + Math.floor((PUNYCODE_BASE - PUNYCODE_TMIN + 1) * delta / (delta + PUNYCODE_SKEW));
  }
  function Decode2(value) {
    const output = [];
    let n = PUNYCODE_INITIAL_N;
    let i = 0;
    let bias = PUNYCODE_INITIAL_BIAS;
    const delimIdx = value.lastIndexOf("-");
    if (delimIdx > 0) {
      for (let j = 0; j < delimIdx; j++) {
        const cp = value.charCodeAt(j);
        if (cp >= 128)
          ThrowDontCare();
        output.push(cp);
      }
    }
    let inIdx = delimIdx < 0 ? 0 : delimIdx + 1;
    while (inIdx < value.length) {
      const oldi = i;
      let w = 1;
      let k = PUNYCODE_BASE;
      while (true) {
        if (inIdx >= value.length)
          ThrowDontCare();
        const ch = value.charCodeAt(inIdx++);
        let digit;
        if (ch >= 97 && ch <= 122)
          digit = ch - 97;
        else if (ch >= 48 && ch <= 57)
          digit = ch - 48 + 26;
        else
          ThrowDontCare();
        i += digit * w;
        const t = k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias;
        if (digit < t)
          break;
        w *= PUNYCODE_BASE - t;
        k += PUNYCODE_BASE;
      }
      const outLen = output.length + 1;
      bias = Adapt(i - oldi, outLen, oldi === 0);
      n += Math.floor(i / outLen);
      i %= outLen;
      output.splice(i, 0, n);
      i++;
    }
    return String.fromCodePoint(...output);
  }
  function DigitToChar(digit) {
    return digit < 26 ? String.fromCharCode(digit + 97) : String.fromCharCode(digit - 26 + 48);
  }
  var RE_REPLACE_NON_ASCII = new RegExp(RE_NON_ASCII.source, "gu");
  function Encode2(input) {
    const basic = input.replace(RE_REPLACE_NON_ASCII, "");
    const basicLength = basic.length;
    const result = basicLength > 0 ? [basic, "-"] : [];
    const codePoints = Array.from(input, (char) => char.codePointAt(0));
    let n = PUNYCODE_INITIAL_N;
    let delta = 0;
    let bias = PUNYCODE_INITIAL_BIAS;
    let handledCPCount = basicLength;
    while (handledCPCount < codePoints.length) {
      let m = Infinity;
      for (const cp of codePoints) {
        if (cp >= n && cp < m)
          m = cp;
      }
      delta += (m - n) * (handledCPCount + 1);
      n = m;
      for (const cp of codePoints) {
        if (cp < n)
          delta++;
        if (cp === n) {
          let q = delta;
          for (let k = PUNYCODE_BASE; ; k += PUNYCODE_BASE) {
            const t = k <= bias ? PUNYCODE_TMIN : k >= bias + PUNYCODE_TMAX ? PUNYCODE_TMAX : k - bias;
            if (q < t)
              break;
            const digit = t + (q - t) % (PUNYCODE_BASE - t);
            result.push(DigitToChar(digit));
            q = Math.floor((q - t) / (PUNYCODE_BASE - t));
          }
          result.push(DigitToChar(q));
          bias = Adapt(delta, handledCPCount + 1, handledCPCount === basicLength);
          delta = 0;
          handledCPCount++;
        }
      }
      delta++;
      n++;
    }
    return result.join("");
  }


  var RE_RTL_ALLOWED = /^(?:R|AL|AN|EN|ES|CS|ET|ON|BN|NSM)$/;
  var RE_LTR_ALLOWED = /^(?:L|EN|ES|CS|ET|ON|BN|NSM)$/;
  var RE_RTL_CLASSES = /^(?:R|AL|AN)$/;
  function HasBidiChars(value) {
    if (IsAcePrefixed(value)) {
      try {
        return HasRightToLeftCharacters(Decode2(value.slice(4).toLowerCase()));
      } catch {
        return false;
      }
    }
    return HasRightToLeftCharacters(value);
  }
  function GetBidiClass(codePoint) {
    const char = String.fromCodePoint(codePoint);
    return RE_EUROPEAN_NUMBER.test(char) ? "EN" : RE_ARABIC_INDIC_DIGIT.test(char) ? "AN" : (
      // Pattern.RE_EUROPEAN_SEPARATOR.test(char) ? 'ES' : // (no-spec-coverage)
      // Pattern.RE_COMMON_SEPARATOR.test(char) ? 'CS' : // (no-spec-coverage)
      RE_MARK_NONSPACING.test(char) ? "NSM" : RE_SCRIPT_HEBREW.test(char) ? "R" : RE_SCRIPT_ARABIC_LETTER.test(char) ? "AL" : RE_LETTER.test(char) ? "L" : "ON"
    );
  }
  function HasRightToLeftCharacters(value) {
    for (const ch of value)
      if (RE_RTL_CLASSES.test(GetBidiClass(ch.codePointAt(0))))
        return true;
    return false;
  }
  function SatisfiesBidiRule(value) {
    let isRtl = false;
    let allowed = RE_LTR_ALLOWED;
    let sawEN = false;
    let sawAN = false;
    let isFirst = true;
    for (const ch of value) {
      const bidiClass = GetBidiClass(ch.codePointAt(0));
      if (isFirst) {
        if (bidiClass !== "L" && bidiClass !== "R" && bidiClass !== "AL")
          return false;
        isRtl = bidiClass === "R" || bidiClass === "AL";
        allowed = isRtl ? RE_RTL_ALLOWED : RE_LTR_ALLOWED;
        isFirst = false;
      }
      if (!allowed.test(bidiClass))
        return false;
      if (bidiClass === "EN")
        sawEN = true;
      else if (bidiClass === "AN")
        sawAN = true;
    }
    if (isRtl && sawEN && sawAN)
      return false;
    return true;
  }


  function ExceedsMaxALabelLength(value) {
    return RE_NON_ASCII.test(value) && Encode2(value).length + 4 > 63;
  }
  function HasInvalidHyphens(chars) {
    if (chars[0] === "-" || chars[chars.length - 1] === "-")
      return true;
    return chars.slice(2).join("").startsWith("--");
  }
  function IsUnicodeLabel(value) {
    if (ExceedsMaxALabelLength(value))
      return false;
    if (HasRightToLeftCharacters(value) && !SatisfiesBidiRule(value))
      return false;
    const chars = [...value];
    const codePoints = chars.map((c) => c.codePointAt(0));
    const length = codePoints.length;
    if (HasInvalidHyphens(chars))
      return false;
    if (RE_COMBINING_MARK.test(chars[0]))
      return false;
    let hasJapanese = false;
    for (let i = 0; i < length; i++) {
      const codePoint = codePoints[i];
      const char = chars[i];
      if (RE_RFC5892_DISALLOWED.test(char))
        return false;
      if (!RE_PERMITTED_CATEGORY.test(char))
        return false;
      if (RE_SCRIPT_JAPANESE.test(char))
        hasJapanese = true;
      const prev = codePoints[i - 1], next = codePoints[i + 1];
      switch (codePoint) {
        case 183:
          if (prev !== 108 || next !== 108)
            return false;
          break;
        // MIDDLE DOT (Catalan)
        case 885:
          if (!next || !RE_SCRIPT_GREEK.test(chars[i + 1]))
            return false;
          break;
        // Greek KERAIA
        case 1523:
        case 1524:
          if (!prev || !RE_SCRIPT_HEBREW.test(chars[i - 1]))
            return false;
          break;
        // Hebrew GERESH
        case 8204:
          if (!prev || prev < 128 && !RE_VIRAMA.test(chars[i - 1]))
            return false;
          break;
        case 8205:
          if (!prev || !RE_VIRAMA.test(chars[i - 1]))
            return false;
          break;
        case 12539:
          break;
      }
    }
    if (value.includes("\u30FB") && !hasJapanese)
      return false;
    return true;
  }


  function IsPunyLabel(value) {
    if (!IsAcePrefixed(value))
      return false;
    try {
      const body = value.slice(4).toLowerCase();
      if (body.lastIndexOf("-") === 0)
        return false;
      const decoded = Decode2(body);
      if (!RE_NON_ASCII.test(decoded))
        return false;
      return IsUnicodeLabel(decoded);
    } catch {
      return false;
    }
  }


  function IsValidLabelLength(value) {
    return value.length > 0 && value.length <= 63;
  }
  function IsLabel(value) {
    return IsValidLabelLength(value) && (IsPunyLabel(value) || IsAsciiLabel(value));
  }
  function IsHostname(value) {
    if (value.length === 0 || value.length > 253)
      return false;
    if (value.charCodeAt(value.length - 1) === 46)
      return false;
    return value.split(".").every((label) => IsLabel(label));
  }


  function IsValidLabelLength2(value) {
    return value.length > 0 && value.length <= 63;
  }
  function IsLabel2(value) {
    return IsValidLabelLength2(value) && (IsPunyLabel(value) || IsUnicodeLabel(value));
  }
  function NormalizeHostname(value) {
    return value.replace(/[\uff01-\uff5e]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248)).normalize("NFC").replace(/[\u00ad\u034f\u180b-\u180d\u200b\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu, "").replace(/[\u002E\u3002\uFF0E\uFF61]/g, ".");
  }
  function IsIdnHostname(value) {
    if (value.length === 0 || value.includes(" "))
      return false;
    const normalized = NormalizeHostname(value);
    if (normalized.length > 253)
      return false;
    const labels = normalized.split(".");
    const hasBidiChars = labels.some((label) => HasBidiChars(label));
    return labels.every((label) => IsLabel2(label) && (!hasBidiChars || SatisfiesBidiRule(label)));
  }


  function IsHostname2(value) {
    return IsHostname(value);
  }


  var IdnEmail = /^(?:[A-Za-z0-9!#$%&'*+\/=?^_`{|}~\u{0080}-\u{10FFFF}-]+(?:\.[A-Za-z0-9!#$%&'*+\/=?^_`{|}~\u{0080}-\u{10FFFF}-]+)*|"(?:[^"\\]|\\.)*")@[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62})(?<!-)(?:\.[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,62})(?<!-))*$/iu;
  function IsIdnEmail(value) {
    return IdnEmail.test(value.normalize("NFC"));
  }


  function IsIdnHostname2(value) {
    return IsIdnHostname(value);
  }


  var IPv4 = /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
  function IsIPv4(value) {
    return IPv4.test(value);
  }


  var IPv6 = /^(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:)?[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)$/i;
  function IsIPv6(value) {
    return IPv6.test(value);
  }


  var InvalidIriChars = /[\x00-\x20\x7F\\]|%(?![0-9a-fA-F]{2})/;
  var MalformedScheme = /^[a-zA-Z][a-zA-Z0-9+\-.]*\/\//;
  function IsIriReference(value) {
    return !InvalidIriChars.test(value) && !MalformedScheme.test(value) && URL.canParse(value, "http://example.com");
  }


  var IpvFutureMatchMaxLength = 2048;
  var IpvFutureMatch = /\[[vV][0-9a-fA-F]+\.[^\]]+\]/;
  var InvalidIriChars2 = /[\x00-\x20<>\^`{|}\\]/;
  var InvalidPercentEncoding = /%(?![0-9a-fA-F]{2})/;
  function NarrowIpvFuture(value) {
    return value.length < IpvFutureMatchMaxLength ? value.replace(IpvFutureMatch, "[::1]") : value;
  }
  function IsIri(value) {
    if (InvalidIriChars2.test(value))
      return false;
    if (InvalidPercentEncoding.test(value))
      return false;
    return URL.canParse(NarrowIpvFuture(value));
  }


  var JsonPointerUriFragment = /^#(?:\/(?:[a-z0-9_\-.!$&'()*+,;:=@]|%[0-9a-f]{2}|~0|~1)*)*$/i;
  function IsJsonPointerUriFragment(value) {
    return JsonPointerUriFragment.test(value);
  }


  var JsonPointer = /^(?:\/(?:[^~/]|~0|~1)*)*$/;
  function IsJsonPointer(value) {
    return JsonPointer.test(value);
  }


  function IsRegex(value) {
    try {
      new RegExp(value, "u");
      return true;
    } catch {
      return false;
    }
  }


  var RelativeJsonPointer = /^(?:0|[1-9][0-9]*)(?:#|(?:\/(?:[^~/]|~0|~1)*)*)$/;
  function IsRelativeJsonPointer(value) {
    return RelativeJsonPointer.test(value);
  }


  var UriReference = /^(?:[a-z][a-z0-9+\-.]*:(?:\/\/(?:(?:[-a-z0-9._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:[\da-f]{1,4}:){6}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|::(?:[\da-f]{1,4}:){5}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:[\da-f]{1,4})?::(?:[\da-f]{1,4}:){4}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,1}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){3}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,2}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){2}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,3}[\da-f]{1,4})?::[\da-f]{1,4}:(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,4}[\da-f]{1,4})?::(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,5}[\da-f]{1,4})?::[\da-f]{1,4}|(?:(?:[\da-f]{1,4}:){0,6}[\da-f]{1,4})?::)|v[0-9a-f]+\.[-a-z0-9._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[-a-z0-9._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:\/\/(?:(?:[-a-z0-9._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:[\da-f]{1,4}:){6}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|::(?:[\da-f]{1,4}:){5}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:[\da-f]{1,4})?::(?:[\da-f]{1,4}:){4}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,1}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){3}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,2}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){2}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,3}[\da-f]{1,4})?::[\da-f]{1,4}:(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,4}[\da-f]{1,4})?::(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,5}[\da-f]{1,4})?::[\da-f]{1,4}|(?:(?:[\da-f]{1,4}:){0,6}[\da-f]{1,4})?::)|v[0-9a-f]+\.[-a-z0-9._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[-a-z0-9._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[-a-z0-9._~!$&'()*+,;=@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?)(?:\?(?:[-a-z0-9._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[-a-z0-9._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function IsUriReference(value) {
    return UriReference.test(value);
  }


  var UriTemplate = /^(?:(?:[^\x00-\x20"<>%\\^`{|}\x7f]|%[0-9a-f]{2})|\{[+#./;?&=,!@|]?(?:[a-z0-9_]|%[0-9a-f]{2})+(?:\.(?:[a-z0-9_]|%[0-9a-f]{2})+)*(?::[1-9]\d{0,3}|\*)?(?:,(?:[a-z0-9_]|%[0-9a-f]{2})+(?:\.(?:[a-z0-9_]|%[0-9a-f]{2})+)*(?::[1-9]\d{0,3}|\*)?)*\})*$/i;
  function IsUriTemplate(value) {
    return UriTemplate.test(value);
  }


  var Uri = /^[a-z][a-z0-9+\-.]*:(?:\/\/(?:(?:[-a-z0-9._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:[\da-f]{1,4}:){6}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|::(?:[\da-f]{1,4}:){5}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:[\da-f]{1,4})?::(?:[\da-f]{1,4}:){4}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,1}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){3}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,2}[\da-f]{1,4})?::(?:[\da-f]{1,4}:){2}(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,3}[\da-f]{1,4})?::[\da-f]{1,4}:(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,4}[\da-f]{1,4})?::(?:[\da-f]{1,4}:[\da-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d))|(?:(?:[\da-f]{1,4}:){0,5}[\da-f]{1,4})?::[\da-f]{1,4}|(?:(?:[\da-f]{1,4}:){0,6}[\da-f]{1,4})?::)|v[0-9a-f]+\.[-a-z0-9._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)|(?:[-a-z0-9._~!$&'()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[-a-z0-9._~!$&'()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[-a-z0-9._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[-a-z0-9._~!$&'()*+,;=:@/?]|%[0-9a-f]{2})*)?$/i;
  function IsUri(value) {
    return Uri.test(value);
  }


  function IsUrl(value) {
    return URL.canParse(value);
  }


  var Uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  function IsUuid(value) {
    return Uuid.test(value);
  }


  var formats = /* @__PURE__ */ new Map();
  function Clear() {
    formats.clear();
  }
  function Entries3() {
    return [...formats.entries()];
  }
  function Set3(format3, check) {
    formats.set(format3, check);
  }
  function Has(format3) {
    return formats.has(format3);
  }
  function Get3(format3) {
    return formats.get(format3);
  }
  function Test(format3, value) {
    return formats.get(format3)?.(value) ?? true;
  }
  function Reset2() {
    Clear();
    formats.set("date-time", IsDateTime);
    formats.set("date", IsDate2);
    formats.set("duration", IsDuration);
    formats.set("email", IsEmail);
    formats.set("hostname", IsHostname2);
    formats.set("idn-email", IsIdnEmail);
    formats.set("idn-hostname", IsIdnHostname2);
    formats.set("ipv4", IsIPv4);
    formats.set("ipv6", IsIPv6);
    formats.set("iri-reference", IsIriReference);
    formats.set("iri", IsIri);
    formats.set("json-pointer-uri-fragment", IsJsonPointerUriFragment);
    formats.set("json-pointer", IsJsonPointer);
    formats.set("regex", IsRegex);
    formats.set("relative-json-pointer", IsRelativeJsonPointer);
    formats.set("time", IsTime);
    formats.set("uri-reference", IsUriReference);
    formats.set("uri-template", IsUriTemplate);
    formats.set("uri", IsUri);
    formats.set("url", IsUrl);
    formats.set("uuid", IsUuid);
  }
  Reset2();


  function BuildFormat(_stack, _context, schema, value) {
    return emit_exports.Call(emit_exports.Member("Format", "Test"), [emit_exports.Constant(schema.format), value]);
  }
  function CheckFormat(_stack, _context, schema, value) {
    return format_exports.Test(schema.format, value);
  }
  function ErrorFormat(stack, context, schemaPath, instancePath, schema, value) {
    return CheckFormat(stack, context, schema, value) || context.AddError({
      keyword: "format",
      schemaPath,
      instancePath,
      params: { format: schema.format }
    });
  }


  function BuildIf(stack, context, schema, value) {
    const thenSchema = IsThen(schema) ? schema.then : true;
    const elseSchema = IsElse(schema) ? schema.else : true;
    return emit_exports.Ternary(BuildSchema(stack, context, schema.if, value), BuildSchema(stack, context, thenSchema, value), BuildSchema(stack, context, elseSchema, value));
  }
  function CheckIf(stack, context, schema, value) {
    const thenSchema = IsThen(schema) ? schema.then : true;
    const elseSchema = IsElse(schema) ? schema.else : true;
    return CheckSchema(stack, context, schema.if, value) ? CheckSchema(stack, context, thenSchema, value) : CheckSchema(stack, context, elseSchema, value);
  }
  function ErrorIf(stack, context, schemaPath, instancePath, schema, value) {
    const thenSchema = IsThen(schema) ? schema.then : true;
    const elseSchema = IsElse(schema) ? schema.else : true;
    const trueContext = new ErrorContext();
    const isIf = ErrorSchema(stack, trueContext, `${schemaPath}/if`, instancePath, schema.if, value) ? ErrorSchema(stack, trueContext, `${schemaPath}/then`, instancePath, thenSchema, value) || context.AddError({
      keyword: "if",
      schemaPath,
      instancePath,
      params: { failingKeyword: "then" }
    }) : ErrorSchema(stack, context, `${schemaPath}/else`, instancePath, elseSchema, value) || context.AddError({
      keyword: "if",
      schemaPath,
      instancePath,
      params: { failingKeyword: "else" }
    });
    if (isIf)
      context.Merge([trueContext]);
    return isIf;
  }


  function BuildItemsSizedStandard(stack, context, schema, value) {
    return emit_exports.ReduceAnd(schema.items.map((schema2, index3) => {
      const isLength = emit_exports.IsLessEqualThan(emit_exports.Member(value, "length"), emit_exports.Constant(index3));
      const isSchema = BuildSchemaPushStack(stack, context, schema2, `${value}[${index3}]`);
      const addIndex = context.AddIndex(emit_exports.Constant(index3));
      return emit_exports.Or(isLength, emit_exports.And(isSchema, addIndex));
    }));
  }
  function BuildItemsSizedFast(stack, context, schema, value) {
    return emit_exports.ReduceAnd(schema.items.map((schema2, index3) => {
      const isLength = emit_exports.IsLessEqualThan(emit_exports.Member(value, "length"), emit_exports.Constant(index3));
      const isSchema = BuildSchemaPushStack(stack, context, schema2, `${value}[${index3}]`);
      return emit_exports.Or(isLength, isSchema);
    }));
  }
  function BuildItemsSized(stack, context, schema, value) {
    return context.UseUnevaluated() ? BuildItemsSizedStandard(stack, context, schema, value) : BuildItemsSizedFast(stack, context, schema, value);
  }
  function CheckItemsSized(stack, context, schema, value) {
    return guard_exports.Every(schema.items, 0, (schema2, index3) => {
      return guard_exports.IsLessEqualThan(value.length, index3) || CheckSchemaPushStack(stack, context, schema2, value[index3]) && context.AddIndex(index3);
    });
  }
  function ErrorItemsSized(stack, context, schemaPath, instancePath, schema, value) {
    return guard_exports.EveryAll(schema.items, 0, (schema2, index3) => {
      const nextSchemaPath = `${schemaPath}/items/${index3}`;
      const nextInstancePath = `${instancePath}/${index3}`;
      return guard_exports.IsLessEqualThan(value.length, index3) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[index3]) && context.AddIndex(index3);
    });
  }
  function BuildItemsUnsizedStandard(stack, context, schema, value) {
    const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
    const isSchema = BuildSchemaPushStack(stack, context, schema.items, "element");
    const addIndex = context.AddIndex("index");
    return emit_exports.Every(value, emit_exports.Constant(offset), ["element", "index"], emit_exports.And(isSchema, addIndex));
  }
  function BuildItemsUnsizedFast(stack, context, schema, value) {
    const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
    const isSchema = BuildSchemaPushStack(stack, context, schema.items, "element");
    return emit_exports.Every(value, emit_exports.Constant(offset), ["element", "index"], isSchema);
  }
  function BuildItemsUnsized(stack, context, schema, value) {
    return context.UseUnevaluated() ? BuildItemsUnsizedStandard(stack, context, schema, value) : BuildItemsUnsizedFast(stack, context, schema, value);
  }
  function CheckItemsUnsized(stack, context, schema, value) {
    const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
    return guard_exports.Every(value, offset, (element, index3) => {
      return CheckSchemaPushStack(stack, context, schema.items, element) && context.AddIndex(index3);
    });
  }
  function ErrorItemsUnsized(stack, context, schemaPath, instancePath, schema, value) {
    const offset = IsPrefixItems(schema) ? schema.prefixItems.length : 0;
    return guard_exports.EveryAll(value, offset, (element, index3) => {
      const nextSchemaPath = `${schemaPath}/items`;
      const nextInstancePath = `${instancePath}/${index3}`;
      return ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema.items, element) && context.AddIndex(index3);
    });
  }
  function BuildItems(stack, context, schema, value) {
    return IsItemsSized(schema) ? BuildItemsSized(stack, context, schema, value) : BuildItemsUnsized(stack, context, schema, value);
  }
  function CheckItems(stack, context, schema, value) {
    return IsItemsSized(schema) ? CheckItemsSized(stack, context, schema, value) : CheckItemsUnsized(stack, context, schema, value);
  }
  function ErrorItems(stack, context, schemaPath, instancePath, schema, value) {
    return IsItemsSized(schema) ? ErrorItemsSized(stack, context, schemaPath, instancePath, schema, value) : ErrorItemsUnsized(stack, context, schemaPath, instancePath, schema, value);
  }


  function IsValid3(schema) {
    return IsContains(schema);
  }
  function BuildMaxContains(stack, context, schema, value) {
    if (!IsValid3(schema))
      return emit_exports.Constant(true);
    const [item] = [Unique()];
    const count = emit_exports.Counted(value, [item, "_"], BuildSchema(stack, context, schema.contains, item));
    return emit_exports.IsLessEqualThan(count, emit_exports.Constant(schema.maxContains));
  }
  function CheckMaxContains(stack, context, schema, value) {
    if (!IsValid3(schema))
      return true;
    const count = guard_exports.Counted(value, (item) => CheckSchema(stack, context, schema.contains, item));
    return guard_exports.IsLessEqualThan(count, schema.maxContains);
  }
  function ErrorMaxContains(stack, context, schemaPath, instancePath, schema, value) {
    const minContains = IsMinContains(schema) ? schema.minContains : 1;
    return CheckMaxContains(stack, context, schema, value) || context.AddError({
      keyword: "contains",
      schemaPath,
      instancePath,
      params: { minContains, maxContains: schema.maxContains }
    });
  }


  function BuildMaximum(_stack, _context, schema, value) {
    return emit_exports.IsLessEqualThan(value, emit_exports.Constant(schema.maximum));
  }
  function CheckMaximum(_stack, _context, schema, value) {
    return guard_exports.IsLessEqualThan(value, schema.maximum);
  }
  function ErrorMaximum(stack, context, schemaPath, instancePath, schema, value) {
    return CheckMaximum(stack, context, schema, value) || context.AddError({
      keyword: "maximum",
      schemaPath,
      instancePath,
      params: { comparison: "<=", limit: schema.maximum }
    });
  }


  function BuildMaxItems(_stack, _context, schema, value) {
    return emit_exports.IsLessEqualThan(emit_exports.Member(value, "length"), emit_exports.Constant(schema.maxItems));
  }
  function CheckMaxItems(_stack, _context, schema, value) {
    return guard_exports.IsLessEqualThan(value.length, schema.maxItems);
  }
  function ErrorMaxItems(stack, context, schemaPath, instancePath, schema, value) {
    return CheckMaxItems(stack, context, schema, value) || context.AddError({
      keyword: "maxItems",
      schemaPath,
      instancePath,
      params: { limit: schema.maxItems }
    });
  }


  function BuildMaxLength(_stack, _context, schema, value) {
    return emit_exports.IsMaxLength(value, emit_exports.Constant(schema.maxLength));
  }
  function CheckMaxLength(_stack, _context, schema, value) {
    return guard_exports.IsMaxLength(value, schema.maxLength);
  }
  function ErrorMaxLength(stack, context, schemaPath, instancePath, schema, value) {
    return CheckMaxLength(stack, context, schema, value) || context.AddError({
      keyword: "maxLength",
      schemaPath,
      instancePath,
      params: { limit: schema.maxLength }
    });
  }


  function BuildMaxProperties(_stack, _context, schema, value) {
    return emit_exports.IsLessEqualThan(emit_exports.Member(emit_exports.Keys(value), "length"), emit_exports.Constant(schema.maxProperties));
  }
  function CheckMaxProperties(_stack, _context, schema, value) {
    return guard_exports.IsLessEqualThan(guard_exports.Keys(value).length, schema.maxProperties);
  }
  function ErrorMaxProperties(stack, context, schemaPath, instancePath, schema, value) {
    return CheckMaxProperties(stack, context, schema, value) || context.AddError({
      keyword: "maxProperties",
      schemaPath,
      instancePath,
      params: { limit: schema.maxProperties }
    });
  }


  function IsValid4(schema) {
    return IsContains(schema);
  }
  function BuildMinContainsStandard(stack, context, schema, value) {
    const [item, index3] = [Unique(), Unique()];
    const count = emit_exports.Counted(value, [item, index3], emit_exports.And(BuildSchema(stack, context, schema.contains, item), context.AddIndex(index3)));
    return emit_exports.IsGreaterEqualThan(count, emit_exports.Constant(schema.minContains));
  }
  function BuildMinContainsFast(stack, context, schema, value) {
    const [item] = [Unique()];
    const count = emit_exports.Counted(value, [item, "_"], BuildSchema(stack, context, schema.contains, item));
    return emit_exports.IsGreaterEqualThan(count, emit_exports.Constant(schema.minContains));
  }
  function BuildMinContains(stack, context, schema, value) {
    if (!IsValid4(schema))
      return emit_exports.Constant(true);
    return context.UseUnevaluated() ? BuildMinContainsStandard(stack, context, schema, value) : BuildMinContainsFast(stack, context, schema, value);
  }
  function CheckMinContains(stack, context, schema, value) {
    if (!IsValid4(schema))
      return true;
    const count = guard_exports.Counted(value, (item, index3) => CheckSchema(stack, context, schema.contains, item) && context.AddIndex(index3));
    return guard_exports.IsGreaterEqualThan(count, schema.minContains);
  }
  function ErrorMinContains(stack, context, schemaPath, instancePath, schema, value) {
    return CheckMinContains(stack, context, schema, value) || context.AddError({
      keyword: "contains",
      schemaPath,
      instancePath,
      params: { minContains: schema.minContains }
    });
  }


  function BuildMinimum(_stack, _context, schema, value) {
    return emit_exports.IsGreaterEqualThan(value, emit_exports.Constant(schema.minimum));
  }
  function CheckMinimum(_stack, _context, schema, value) {
    return guard_exports.IsGreaterEqualThan(value, schema.minimum);
  }
  function ErrorMinimum(stack, context, schemaPath, instancePath, schema, value) {
    return CheckMinimum(stack, context, schema, value) || context.AddError({
      keyword: "minimum",
      schemaPath,
      instancePath,
      params: { comparison: ">=", limit: schema.minimum }
    });
  }


  function BuildMinItems(_stack, _context, schema, value) {
    return emit_exports.IsGreaterEqualThan(emit_exports.Member(value, "length"), emit_exports.Constant(schema.minItems));
  }
  function CheckMinItems(_stack, _context, schema, value) {
    return guard_exports.IsGreaterEqualThan(value.length, schema.minItems);
  }
  function ErrorMinItems(stack, context, schemaPath, instancePath, schema, value) {
    return CheckMinItems(stack, context, schema, value) || context.AddError({
      keyword: "minItems",
      schemaPath,
      instancePath,
      params: { limit: schema.minItems }
    });
  }


  function BuildMinLength(_stack, _context, schema, value) {
    return emit_exports.IsMinLength(value, emit_exports.Constant(schema.minLength));
  }
  function CheckMinLength(_stack, _context, schema, value) {
    return guard_exports.IsMinLength(value, schema.minLength);
  }
  function ErrorMinLength(stack, context, schemaPath, instancePath, schema, value) {
    return CheckMinLength(stack, context, schema, value) || context.AddError({
      keyword: "minLength",
      schemaPath,
      instancePath,
      params: { limit: schema.minLength }
    });
  }


  function BuildMinProperties(_stack, _context, schema, value) {
    return emit_exports.IsGreaterEqualThan(emit_exports.Member(emit_exports.Keys(value), "length"), emit_exports.Constant(schema.minProperties));
  }
  function CheckMinProperties(_stack, _context, schema, value) {
    return guard_exports.IsGreaterEqualThan(guard_exports.Keys(value).length, schema.minProperties);
  }
  function ErrorMinProperties(stack, context, schemaPath, instancePath, schema, value) {
    return CheckMinProperties(stack, context, schema, value) || context.AddError({
      keyword: "minProperties",
      schemaPath,
      instancePath,
      params: { limit: schema.minProperties }
    });
  }


  function BuildMultipleOf(_stack, _context, schema, value) {
    return emit_exports.MultipleOf(value, emit_exports.Constant(schema.multipleOf));
  }
  function CheckMultipleOf(_stack, _context, schema, value) {
    return guard_exports.IsMultipleOf(value, schema.multipleOf);
  }
  function ErrorMultipleOf(stack, context, schemaPath, instancePath, schema, value) {
    return CheckMultipleOf(stack, context, schema, value) || context.AddError({
      keyword: "multipleOf",
      schemaPath,
      instancePath,
      params: { multipleOf: schema.multipleOf }
    });
  }


  function BuildNotStandard(stack, context, schema, value) {
    return Reducer(stack, context, [schema.not], value, emit_exports.Not(emit_exports.IsEqual(emit_exports.Member("results", "length"), emit_exports.Constant(1))));
  }
  function BuildNotFast(stack, context, schema, value) {
    return emit_exports.Not(BuildSchema(stack, context, schema.not, value));
  }
  function BuildNot(stack, context, schema, value) {
    return context.UseUnevaluated() ? BuildNotStandard(stack, context, schema, value) : BuildNotFast(stack, context, schema, value);
  }
  function CheckNot(stack, context, schema, value) {
    const nextContext = new CheckContext();
    const isSchema = !CheckSchema(stack, nextContext, schema.not, value);
    const isNot = isSchema && context.Merge([nextContext]);
    return isNot;
  }
  function ErrorNot(stack, context, schemaPath, instancePath, schema, value) {
    return CheckNot(stack, context, schema, value) || context.AddError({
      keyword: "not",
      schemaPath,
      instancePath,
      params: {}
    });
  }


  function BuildOneOfStandard(stack, context, schema, value) {
    return Reducer(stack, context, schema.oneOf, value, emit_exports.IsEqual(emit_exports.Member("results", "length"), emit_exports.Constant(1)));
  }
  function BuildOneOfFast(stack, context, schema, value) {
    const [result] = [Unique()];
    const results = emit_exports.ArrayLiteral(schema.oneOf.map((schema2) => BuildSchema(stack, context, schema2, value)));
    const count = emit_exports.Counted(results, [result, "_"], emit_exports.IsEqual(result, emit_exports.Constant(true)));
    return emit_exports.IsEqual(count, emit_exports.Constant(1));
  }
  function BuildOneOf(stack, context, schema, value) {
    return context.UseUnevaluated() ? BuildOneOfStandard(stack, context, schema, value) : BuildOneOfFast(stack, context, schema, value);
  }
  function CheckOneOf(stack, context, schema, value) {
    const passedContexts = schema.oneOf.reduce((result, schema2) => {
      const nextContext = new CheckContext();
      return CheckSchema(stack, nextContext, schema2, value) ? [...result, nextContext] : result;
    }, []);
    return guard_exports.IsEqual(passedContexts.length, 1) && context.Merge(passedContexts);
  }
  function ErrorOneOf(stack, context, schemaPath, instancePath, schema, value) {
    const failedContexts = [];
    const passingSchemas = [];
    const passedContexts = schema.oneOf.reduce((result, schema2, index3) => {
      const nextContext = new ErrorContext();
      const nextSchemaPath = `${schemaPath}/oneOf/${index3}`;
      const isSchema = ErrorSchema(stack, nextContext, nextSchemaPath, instancePath, schema2, value);
      if (isSchema)
        passingSchemas.push(index3);
      if (!isSchema)
        failedContexts.push(nextContext);
      return isSchema ? [...result, nextContext] : result;
    }, []);
    const isOneOf = guard_exports.IsEqual(passedContexts.length, 1) && context.Merge(passedContexts);
    if (!isOneOf && guard_exports.IsEqual(passingSchemas.length, 0))
      failedContexts.forEach((failed) => failed.GetErrors().forEach((error2) => context.AddError(error2)));
    return isOneOf || context.AddError({
      keyword: "oneOf",
      schemaPath,
      instancePath,
      params: { passingSchemas }
    });
  }


  function BuildPattern(_stack, _context, schema, value) {
    const regexp = CreateVariable(guard_exports.IsString(schema.pattern) ? UnicodeRegExp(schema.pattern) : schema.pattern);
    return emit_exports.Call(emit_exports.Member(regexp, "test"), [value]);
  }
  function CheckPattern(_stack, _context, schema, value) {
    const regexp = guard_exports.IsString(schema.pattern) ? UnicodeRegExp(schema.pattern) : schema.pattern;
    return regexp.test(value);
  }
  function ErrorPattern(stack, context, schemaPath, instancePath, schema, value) {
    return CheckPattern(stack, context, schema, value) || context.AddError({
      keyword: "pattern",
      schemaPath,
      instancePath,
      params: { pattern: schema.pattern }
    });
  }


  function BuildPatternProperties(stack, context, schema, value) {
    return emit_exports.ReduceAnd(guard_exports.Entries(schema.patternProperties).map(([pattern, schema2]) => {
      const [key, prop] = [Unique(), Unique()];
      const regexp = CreateVariable(UnicodeRegExp(pattern));
      const notKey = emit_exports.Not(emit_exports.Call(emit_exports.Member(regexp, "test"), [key]));
      const isSchema = BuildSchemaPushStack(stack, context, schema2, prop);
      const addKey = context.AddKey(key);
      const guarded = context.UseUnevaluated() ? emit_exports.Or(notKey, emit_exports.And(isSchema, addKey)) : emit_exports.Or(notKey, isSchema);
      return emit_exports.Every(emit_exports.Entries(value), emit_exports.Constant(0), [`[${key}, ${prop}]`, "_"], guarded);
    }));
  }
  function CheckPatternProperties(stack, context, schema, value) {
    return guard_exports.Every(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
      const regexp = UnicodeRegExp(pattern);
      return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
        return !regexp.test(key) || CheckSchemaPushStack(stack, context, schema2, prop) && context.AddKey(key);
      });
    });
  }
  function ErrorPatternProperties(stack, context, schemaPath, instancePath, schema, value) {
    return guard_exports.EveryAll(guard_exports.Entries(schema.patternProperties), 0, ([pattern, schema2]) => {
      const nextSchemaPath = `${schemaPath}/patternProperties/${pattern}`;
      const regexp = UnicodeRegExp(pattern);
      return guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, value2]) => {
        const nextInstancePath = `${instancePath}/${key}`;
        const notKey = !regexp.test(key);
        return notKey || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value2) && context.AddKey(key);
      });
    });
  }


  function BuildPrefixItems(stack, context, schema, value) {
    return emit_exports.ReduceAnd(schema.prefixItems.map((schema2, index3) => {
      const isLength = emit_exports.IsLessEqualThan(emit_exports.Member(value, "length"), emit_exports.Constant(index3));
      const isSchema = BuildSchemaPushStack(stack, context, schema2, `${value}[${index3}]`);
      const addIndex = context.AddIndex(emit_exports.Constant(index3));
      const guarded = context.UseUnevaluated() ? emit_exports.And(isSchema, addIndex) : isSchema;
      return emit_exports.Or(isLength, guarded);
    }));
  }
  function CheckPrefixItems(stack, context, schema, value) {
    return guard_exports.IsEqual(value.length, 0) || guard_exports.Every(schema.prefixItems, 0, (schema2, index3) => {
      return guard_exports.IsLessEqualThan(value.length, index3) || CheckSchemaPushStack(stack, context, schema2, value[index3]) && context.AddIndex(index3);
    });
  }
  function ErrorPrefixItems(stack, context, schemaPath, instancePath, schema, value) {
    return guard_exports.IsEqual(value.length, 0) || guard_exports.EveryAll(schema.prefixItems, 0, (schema2, index3) => {
      const nextSchemaPath = `${schemaPath}/prefixItems/${index3}`;
      const nextInstancePath = `${instancePath}/${index3}`;
      return guard_exports.IsLessEqualThan(value.length, index3) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[index3]) && context.AddIndex(index3);
    });
  }


  function IsExactOptional(required, key) {
    return required.includes(key) || settings_exports.Get().exactOptionalPropertyTypes;
  }
  function InexactOptionalBuild(value, key) {
    return emit_exports.IsUndefined(emit_exports.Member(value, key));
  }
  function InexactOptionalCheck(value, key) {
    return guard_exports.IsUndefined(value[key]);
  }


  function BuildProperties(stack, context, schema, value) {
    const required = IsRequired(schema) ? schema.required : [];
    const everyKey = guard_exports.Entries(schema.properties).map(([key, schema2]) => {
      const notKey = emit_exports.Not(emit_exports.HasPropertyKey(value, emit_exports.Constant(key)));
      const isSchema = BuildSchemaPushStack(stack, context, schema2, emit_exports.Member(value, key));
      const addKey = context.AddKey(emit_exports.Constant(key));
      const guarded = context.UseUnevaluated() ? emit_exports.And(isSchema, addKey) : isSchema;
      const isProperty = required.includes(key) ? guarded : emit_exports.Or(notKey, guarded);
      return IsExactOptional(required, key) ? isProperty : emit_exports.Or(InexactOptionalBuild(value, key), isProperty);
    });
    return emit_exports.ReduceAnd(everyKey);
  }
  function CheckProperties(stack, context, schema, value) {
    const required = IsRequired(schema) ? schema.required : [];
    const isProperties = guard_exports.Every(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
      const isProperty = !guard_exports.HasPropertyKey(value, key) || CheckSchemaPushStack(stack, context, schema2, value[key]) && context.AddKey(key);
      return IsExactOptional(required, key) ? isProperty : InexactOptionalCheck(value, key) || isProperty;
    });
    return isProperties;
  }
  function ErrorProperties(stack, context, schemaPath, instancePath, schema, value) {
    const required = IsRequired(schema) ? schema.required : [];
    const isProperties = guard_exports.EveryAll(guard_exports.Entries(schema.properties), 0, ([key, schema2]) => {
      const nextSchemaPath = `${schemaPath}/properties/${key}`;
      const nextInstancePath = `${instancePath}/${key}`;
      const isProperty = () => !guard_exports.HasPropertyKey(value, key) || ErrorSchemaPushStack(stack, context, nextSchemaPath, nextInstancePath, schema2, value[key]) && context.AddKey(key);
      return IsExactOptional(required, key) ? isProperty() : InexactOptionalCheck(value, key) || isProperty();
    });
    return isProperties;
  }


  function BuildPropertyNames(stack, context, schema, value) {
    const [key, _index] = [Unique(), Unique()];
    return emit_exports.Every(emit_exports.Keys(value), emit_exports.Constant(0), [key, _index], BuildSchema(stack, context, schema.propertyNames, key));
  }
  function CheckPropertyNames(stack, context, schema, value) {
    return guard_exports.Every(guard_exports.Keys(value), 0, (key, _index) => CheckSchema(stack, context, schema.propertyNames, key));
  }
  function ErrorPropertyNames(stack, context, schemaPath, instancePath, schema, value) {
    const propertyNames = [];
    const isPropertyNames = guard_exports.EveryAll(guard_exports.Keys(value), 0, (key, _index) => {
      const nextInstancePath = `${instancePath}/${key}`;
      const nextSchemaPath = `${schemaPath}/propertyNames`;
      const isPropertyName = ErrorSchema(stack, context, nextSchemaPath, nextInstancePath, schema.propertyNames, key);
      if (!isPropertyName)
        propertyNames.push(key);
      return isPropertyName;
    });
    return isPropertyNames || context.AddError({
      keyword: "propertyNames",
      schemaPath,
      instancePath,
      params: { propertyNames }
    });
  }


  function BuildRecursiveRef(stack, context, schema, value) {
    const target = stack.RecursiveRef(schema) ?? false;
    return CreateFunction(stack, context, target, value);
  }
  function CheckRecursiveRef(stack, context, schema, value) {
    const target = stack.RecursiveRef(schema) ?? false;
    return IsSchema2(target) && CheckSchema(stack, context, target, value);
  }
  function ErrorRecursiveRef(stack, context, _schemaPath, instancePath, schema, value) {
    const target = stack.RecursiveRef(schema) ?? false;
    return IsSchema2(target) && ErrorSchema(stack, context, "#", instancePath, target, value);
  }


  function BuildRefStandard(stack, context, target, value) {
    const interior = emit_exports.ArrowFunction(["context", "value"], CreateFunction(stack, context, target, "value"));
    const exterior = emit_exports.ArrowFunction(["context", "value"], emit_exports.Statements([
      emit_exports.ConstDeclaration("nextContext", emit_exports.New("CheckContext", [])),
      emit_exports.ConstDeclaration("result", emit_exports.Call(interior, ["nextContext", "value"])),
      emit_exports.If("result", context.Merge("[nextContext]")),
      emit_exports.Return("result")
    ]));
    return emit_exports.Call(exterior, ["context", value]);
  }
  function BuildRefFast(stack, context, target, value) {
    return CreateFunction(stack, context, target, value);
  }
  function BuildRef(stack, context, schema, value) {
    const target = stack.Ref(schema) ?? false;
    return context.UseUnevaluated() ? BuildRefStandard(stack, context, target, value) : BuildRefFast(stack, context, target, value);
  }
  function CheckRef(stack, context, schema, value) {
    const target = stack.Ref(schema) ?? false;
    const nextContext = new CheckContext();
    const result = IsSchema2(target) && CheckSchema(stack, nextContext, target, value);
    if (result)
      context.Merge([nextContext]);
    return result;
  }
  function ErrorRef(stack, context, _schemaPath, instancePath, schema, value) {
    const target = stack.Ref(schema) ?? false;
    const nextContext = new ErrorContext();
    const result = IsSchema2(target) && ErrorSchema(stack, nextContext, "#", instancePath, target, value);
    if (result)
      context.Merge([nextContext]);
    if (!result)
      nextContext.GetErrors().forEach((error2) => context.AddError(error2));
    return result;
  }


  function BuildRequired(_stack, _context, schema, value) {
    return emit_exports.ReduceAnd(schema.required.map((key) => emit_exports.HasPropertyKey(value, emit_exports.Constant(key))));
  }
  function CheckRequired(_stack, _context, schema, value) {
    return guard_exports.Every(schema.required, 0, (key) => guard_exports.HasPropertyKey(value, key));
  }
  function ErrorRequired(_stack, context, schemaPath, instancePath, schema, value) {
    const requiredProperties = [];
    const isRequired = guard_exports.EveryAll(schema.required, 0, (key) => {
      const hasKey = guard_exports.HasPropertyKey(value, key);
      if (!hasKey)
        requiredProperties.push(key);
      return hasKey;
    });
    return isRequired || context.AddError({
      keyword: "required",
      schemaPath,
      instancePath,
      params: { requiredProperties }
    });
  }


  function BuildTypeName(_stack, _context, type2, value) {
    return (
      // jsonschema
      guard_exports.IsEqual(type2, "object") ? emit_exports.IsObjectNotArray(value) : guard_exports.IsEqual(type2, "array") ? emit_exports.IsArray(value) : guard_exports.IsEqual(type2, "boolean") ? emit_exports.IsBoolean(value) : guard_exports.IsEqual(type2, "integer") ? emit_exports.IsInteger(value) : guard_exports.IsEqual(type2, "number") ? emit_exports.IsNumber(value) : guard_exports.IsEqual(type2, "null") ? emit_exports.IsNull(value) : guard_exports.IsEqual(type2, "string") ? emit_exports.IsString(value) : (
        // xschema
        guard_exports.IsEqual(type2, "bigint") ? emit_exports.IsBigInt(value) : guard_exports.IsEqual(type2, "constructor") ? emit_exports.IsConstructor(value) : guard_exports.IsEqual(type2, "function") ? emit_exports.IsFunction(value) : guard_exports.IsEqual(type2, "symbol") ? emit_exports.IsSymbol(value) : guard_exports.IsEqual(type2, "undefined") ? emit_exports.IsUndefined(value) : guard_exports.IsEqual(type2, "void") ? emit_exports.IsUndefined(value) : emit_exports.Constant(true)
      )
    );
  }
  function CheckTypeName(_stack, _context, type2, _schema, value) {
    return (
      // jsonschema
      guard_exports.IsEqual(type2, "object") ? guard_exports.IsObjectNotArray(value) : guard_exports.IsEqual(type2, "array") ? guard_exports.IsArray(value) : guard_exports.IsEqual(type2, "boolean") ? guard_exports.IsBoolean(value) : guard_exports.IsEqual(type2, "integer") ? guard_exports.IsInteger(value) : guard_exports.IsEqual(type2, "number") ? guard_exports.IsNumber(value) : guard_exports.IsEqual(type2, "null") ? guard_exports.IsNull(value) : guard_exports.IsEqual(type2, "string") ? guard_exports.IsString(value) : (
        // xschema
        guard_exports.IsEqual(type2, "bigint") ? guard_exports.IsBigInt(value) : guard_exports.IsEqual(type2, "constructor") ? guard_exports.IsConstructor(value) : guard_exports.IsEqual(type2, "function") ? guard_exports.IsFunction(value) : guard_exports.IsEqual(type2, "symbol") ? guard_exports.IsSymbol(value) : guard_exports.IsEqual(type2, "undefined") ? guard_exports.IsUndefined(value) : guard_exports.IsEqual(type2, "void") ? guard_exports.IsUndefined(value) : true
      )
    );
  }
  function BuildTypeNames(stack, context, typenames, value) {
    return emit_exports.ReduceOr(typenames.map((type2) => BuildTypeName(stack, context, type2, value)));
  }
  function CheckTypeNames(stack, context, types2, schema, value) {
    return guard_exports.Some(types2, (type2) => CheckTypeName(stack, context, type2, schema, value));
  }
  function BuildType(stack, context, schema, value) {
    return guard_exports.IsArray(schema.type) ? BuildTypeNames(stack, context, schema.type, value) : BuildTypeName(stack, context, schema.type, value);
  }
  function CheckType(stack, context, schema, value) {
    return guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context, schema.type, schema, value) : CheckTypeName(stack, context, schema.type, schema, value);
  }
  function ErrorType(stack, context, schemaPath, instancePath, schema, value) {
    const isType = guard_exports.IsArray(schema.type) ? CheckTypeNames(stack, context, schema.type, schema, value) : CheckTypeName(stack, context, schema.type, schema, value);
    return isType || context.AddError({
      keyword: "type",
      schemaPath,
      instancePath,
      params: { type: schema.type }
    });
  }


  function BuildUnevaluatedItems(stack, context, schema, value) {
    const [index3, item] = [Unique(), Unique()];
    const indices = emit_exports.Call(emit_exports.Member("context", "GetIndices"), []);
    const hasIndex = emit_exports.Call(emit_exports.Member("indices", "has"), [index3]);
    const isSchema = BuildSchema(stack, context, schema.unevaluatedItems, item);
    const addIndex = emit_exports.Call(emit_exports.Member("context", "AddIndex"), [index3]);
    const isEvery = emit_exports.Every(value, emit_exports.Constant(0), [item, index3], emit_exports.And(emit_exports.Or(hasIndex, isSchema), addIndex));
    return emit_exports.Call(emit_exports.ArrowFunction(["context"], emit_exports.Statements([
      emit_exports.ConstDeclaration("indices", indices),
      emit_exports.Return(isEvery)
    ])), ["context"]);
  }
  function CheckUnevaluatedItems(stack, context, schema, value) {
    const indices = context.GetIndices();
    return guard_exports.Every(value, 0, (item, index3) => {
      return (indices.has(index3) || CheckSchema(stack, context, schema.unevaluatedItems, item)) && context.AddIndex(index3);
    });
  }
  function ErrorUnevaluatedItems(stack, context, schemaPath, instancePath, schema, value) {
    const indices = context.GetIndices();
    const unevaluatedItems = [];
    const isUnevaluatedItems = guard_exports.EveryAll(value, 0, (item, index3) => {
      const nextContext = new ErrorContext();
      const isEvaluatedItem = (indices.has(index3) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedItems, item)) && context.AddIndex(index3);
      if (!isEvaluatedItem)
        unevaluatedItems.push(index3);
      return isEvaluatedItem;
    });
    return isUnevaluatedItems || context.AddError({
      keyword: "unevaluatedItems",
      schemaPath,
      instancePath,
      params: { unevaluatedItems }
    });
  }


  function BuildUnevaluatedProperties(stack, context, schema, value) {
    const [key, prop] = [Unique(), Unique()];
    const keys = emit_exports.Call(emit_exports.Member("context", "GetKeys"), []);
    const hasKey = emit_exports.Call(emit_exports.Member("keys", "has"), [key]);
    const addKey = emit_exports.Call(emit_exports.Member("context", "AddKey"), [key]);
    const isSchema = BuildSchema(stack, context, schema.unevaluatedProperties, prop);
    const isEvery = emit_exports.Every(emit_exports.Entries(value), emit_exports.Constant(0), [`[${key}, ${prop}]`, "_"], emit_exports.Or(hasKey, emit_exports.And(isSchema, addKey)));
    return emit_exports.Call(emit_exports.ArrowFunction(["context"], emit_exports.Statements([
      emit_exports.ConstDeclaration("keys", keys),
      emit_exports.Return(isEvery)
    ])), ["context"]);
  }
  function CheckUnevaluatedProperties(stack, context, schema, value) {
    const keys = context.GetKeys();
    return guard_exports.Every(guard_exports.Entries(value), 0, ([key, prop]) => {
      return keys.has(key) || CheckSchema(stack, context, schema.unevaluatedProperties, prop) && context.AddKey(key);
    });
  }
  function ErrorUnevaluatedProperties(stack, context, schemaPath, instancePath, schema, value) {
    const keys = context.GetKeys();
    const unevaluatedProperties = [];
    const isUnevaluatedProperties = guard_exports.EveryAll(guard_exports.Entries(value), 0, ([key, prop]) => {
      const nextContext = new ErrorContext();
      const isEvaluatedProperty = keys.has(key) || ErrorSchema(stack, nextContext, schemaPath, instancePath, schema.unevaluatedProperties, prop) && context.AddKey(key);
      if (!isEvaluatedProperty)
        unevaluatedProperties.push(key);
      return isEvaluatedProperty;
    });
    return isUnevaluatedProperties || context.AddError({
      keyword: "unevaluatedProperties",
      schemaPath,
      instancePath,
      params: { unevaluatedProperties }
    });
  }


  function IsValid5(schema) {
    return !guard_exports.IsEqual(schema.uniqueItems, false);
  }
  function BuildUniqueItems(_stack, _context, schema, value) {
    if (!IsValid5(schema))
      return emit_exports.Constant(true);
    const set = emit_exports.Member(emit_exports.New("Set", [emit_exports.Call(emit_exports.Member(value, "map"), [emit_exports.Member("Hashing", "Hash")])]), "size");
    const isLength = emit_exports.Member(value, "length");
    return emit_exports.IsEqual(set, isLength);
  }
  function CheckUniqueItems(_stack, _context, schema, value) {
    if (!IsValid5(schema))
      return true;
    const set = new Set(value.map(hash_exports.Hash)).size;
    const isLength = value.length;
    return guard_exports.IsEqual(set, isLength);
  }
  function ErrorUniqueItems(_stack, context, schemaPath, instancePath, schema, value) {
    if (!IsValid5(schema))
      return true;
    const set = /* @__PURE__ */ new Set();
    const duplicateItems = value.reduce((result, value2, index3) => {
      const hash = hash_exports.Hash(value2);
      if (set.has(hash))
        return [...result, index3];
      set.add(hash);
      return result;
    }, []);
    const isUniqueItems = guard_exports.IsEqual(duplicateItems.length, 0);
    return isUniqueItems || context.AddError({
      keyword: "uniqueItems",
      schemaPath,
      instancePath,
      params: { duplicateItems }
    });
  }


  function HasTypeName(schema, typename) {
    return IsType(schema) && (guard_exports.IsArray(schema.type) && guard_exports.IsGreaterThan(schema.type.length, 0) && guard_exports.Every(schema.type, 0, (type2) => guard_exports.IsEqual(type2, typename)) || guard_exports.IsEqual(schema.type, typename));
  }
  function HasObjectType(schema) {
    return HasTypeName(schema, "object");
  }
  function HasObjectKeywords(schema) {
    return IsSchemaObject2(schema) && (IsAdditionalProperties(schema) || IsDependencies(schema) || IsDependentRequired(schema) || IsDependentSchemas(schema) || IsProperties(schema) || IsPatternProperties(schema) || IsPropertyNames(schema) || IsMinProperties(schema) || IsMaxProperties(schema) || IsRequired(schema) || IsUnevaluatedProperties(schema));
  }
  function HasArrayType(schema) {
    return HasTypeName(schema, "array");
  }
  function HasArrayKeywords(schema) {
    return IsSchemaObject2(schema) && (IsAdditionalItems(schema) || IsItems(schema) || IsContains(schema) || IsMaxContains(schema) || IsMaxItems(schema) || IsMinContains(schema) || IsMinItems(schema) || IsPrefixItems(schema) || IsUnevaluatedItems(schema) || IsUniqueItems(schema));
  }
  function HasStringType(schema) {
    return HasTypeName(schema, "string");
  }
  function HasStringKeywords(schema) {
    return IsSchemaObject2(schema) && (IsMinLength4(schema) || IsMaxLength4(schema) || IsFormat(schema) || IsPattern(schema));
  }
  function HasNumberType(schema) {
    return HasTypeName(schema, "number") || HasTypeName(schema, "bigint");
  }
  function HasNumberKeywords(schema) {
    return IsSchemaObject2(schema) && (IsMinimum(schema) || IsMaximum(schema) || IsExclusiveMaximum(schema) || IsExclusiveMinimum(schema) || IsMultipleOf2(schema));
  }
  function BuildSchemaPushStack(stack, context, schema, value) {
    return context.UseUnevaluated() ? emit_exports.And(emit_exports.And(context.Push(), BuildSchema(stack, context, schema, value)), context.Pop()) : BuildSchema(stack, context, schema, value);
  }
  function BuildSchema(stack, context, schema, value) {
    stack.Push(schema);
    const conditions = [];
    if (IsSchemaBoolean(schema))
      return BuildSchemaBoolean(stack, context, schema, value);
    if (IsType(schema))
      conditions.push(BuildType(stack, context, schema, value));
    if (HasObjectKeywords(schema)) {
      const constraints = [];
      if (IsRequired(schema))
        constraints.push(BuildRequired(stack, context, schema, value));
      if (IsAdditionalProperties(schema))
        constraints.push(BuildAdditionalProperties(stack, context, schema, value));
      if (IsDependencies(schema))
        constraints.push(BuildDependencies(stack, context, schema, value));
      if (IsDependentRequired(schema))
        constraints.push(BuildDependentRequired(stack, context, schema, value));
      if (IsDependentSchemas(schema))
        constraints.push(BuildDependentSchemas(stack, context, schema, value));
      if (IsPatternProperties(schema))
        constraints.push(BuildPatternProperties(stack, context, schema, value));
      if (IsProperties(schema))
        constraints.push(BuildProperties(stack, context, schema, value));
      if (IsPropertyNames(schema))
        constraints.push(BuildPropertyNames(stack, context, schema, value));
      if (IsMinProperties(schema))
        constraints.push(BuildMinProperties(stack, context, schema, value));
      if (IsMaxProperties(schema))
        constraints.push(BuildMaxProperties(stack, context, schema, value));
      const reduced = emit_exports.ReduceAnd(constraints);
      const guarded = emit_exports.Or(emit_exports.Not(emit_exports.IsObjectNotArray(value)), reduced);
      conditions.push(HasObjectType(schema) ? reduced : guarded);
    }
    if (HasArrayKeywords(schema)) {
      const constraints = [];
      if (IsAdditionalItems(schema))
        constraints.push(BuildAdditionalItems(stack, context, schema, value));
      if (IsContains(schema))
        constraints.push(BuildContains(stack, context, schema, value));
      if (IsItems(schema))
        constraints.push(BuildItems(stack, context, schema, value));
      if (IsMaxContains(schema))
        constraints.push(BuildMaxContains(stack, context, schema, value));
      if (IsMaxItems(schema))
        constraints.push(BuildMaxItems(stack, context, schema, value));
      if (IsMinContains(schema))
        constraints.push(BuildMinContains(stack, context, schema, value));
      if (IsMinItems(schema))
        constraints.push(BuildMinItems(stack, context, schema, value));
      if (IsPrefixItems(schema))
        constraints.push(BuildPrefixItems(stack, context, schema, value));
      if (IsUniqueItems(schema))
        constraints.push(BuildUniqueItems(stack, context, schema, value));
      const reduced = emit_exports.ReduceAnd(constraints);
      const guarded = emit_exports.Or(emit_exports.Not(emit_exports.IsArray(value)), reduced);
      conditions.push(HasArrayType(schema) ? reduced : guarded);
    }
    if (HasStringKeywords(schema)) {
      const constraints = [];
      if (IsMaxLength4(schema))
        constraints.push(BuildMaxLength(stack, context, schema, value));
      if (IsMinLength4(schema))
        constraints.push(BuildMinLength(stack, context, schema, value));
      if (IsFormat(schema))
        constraints.push(BuildFormat(stack, context, schema, value));
      if (IsPattern(schema))
        constraints.push(BuildPattern(stack, context, schema, value));
      const reduced = emit_exports.ReduceAnd(constraints);
      const guarded = emit_exports.Or(emit_exports.Not(emit_exports.IsString(value)), reduced);
      conditions.push(HasStringType(schema) ? reduced : guarded);
    }
    if (HasNumberKeywords(schema)) {
      const constraints = [];
      if (IsExclusiveMaximum(schema))
        constraints.push(BuildExclusiveMaximum(stack, context, schema, value));
      if (IsExclusiveMinimum(schema))
        constraints.push(BuildExclusiveMinimum(stack, context, schema, value));
      if (IsMaximum(schema))
        constraints.push(BuildMaximum(stack, context, schema, value));
      if (IsMinimum(schema))
        constraints.push(BuildMinimum(stack, context, schema, value));
      if (IsMultipleOf2(schema))
        constraints.push(BuildMultipleOf(stack, context, schema, value));
      const reduced = emit_exports.ReduceAnd(constraints);
      const guarded = emit_exports.Or(emit_exports.Not(emit_exports.Or(emit_exports.IsNumber(value), emit_exports.IsBigInt(value))), reduced);
      conditions.push(HasNumberType(schema) ? reduced : guarded);
    }
    if (IsRef2(schema))
      conditions.push(BuildRef(stack, context, schema, value));
    if (IsRecursiveRef(schema))
      conditions.push(BuildRecursiveRef(stack, context, schema, value));
    if (IsDynamicRef(schema))
      conditions.push(BuildDynamicRef(stack, context, schema, value));
    if (IsConst(schema))
      conditions.push(BuildConst(stack, context, schema, value));
    if (IsEnum2(schema))
      conditions.push(BuildEnum(stack, context, schema, value));
    if (IsIf(schema))
      conditions.push(BuildIf(stack, context, schema, value));
    if (IsNot(schema))
      conditions.push(BuildNot(stack, context, schema, value));
    if (IsAllOf(schema))
      conditions.push(BuildAllOf(stack, context, schema, value));
    if (IsAnyOf(schema))
      conditions.push(BuildAnyOf(stack, context, schema, value));
    if (IsOneOf(schema))
      conditions.push(BuildOneOf(stack, context, schema, value));
    if (IsUnevaluatedItems(schema))
      conditions.push(emit_exports.Or(emit_exports.Not(emit_exports.IsArray(value)), BuildUnevaluatedItems(stack, context, schema, value)));
    if (IsUnevaluatedProperties(schema))
      conditions.push(emit_exports.Or(emit_exports.Not(emit_exports.IsObject(value)), BuildUnevaluatedProperties(stack, context, schema, value)));
    if (IsRefine2(schema))
      conditions.push(BuildRefine(stack, context, schema, value));
    const result = emit_exports.ReduceAnd(conditions);
    stack.Pop(schema);
    return result;
  }
  function CheckSchemaPushStack(stack, context, schema, value) {
    return context.Push() && CheckSchema(stack, context, schema, value) && context.Pop();
  }
  function CheckSchema(stack, context, schema, value) {
    stack.Push(schema);
    const result = IsSchemaBoolean(schema) ? CheckSchemaBoolean(stack, context, schema, value) : (!IsType(schema) || CheckType(stack, context, schema, value)) && (!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || (!IsRequired(schema) || CheckRequired(stack, context, schema, value)) && (!IsAdditionalProperties(schema) || CheckAdditionalProperties(stack, context, schema, value)) && (!IsDependencies(schema) || CheckDependencies(stack, context, schema, value)) && (!IsDependentRequired(schema) || CheckDependentRequired(stack, context, schema, value)) && (!IsDependentSchemas(schema) || CheckDependentSchemas(stack, context, schema, value)) && (!IsPatternProperties(schema) || CheckPatternProperties(stack, context, schema, value)) && (!IsProperties(schema) || CheckProperties(stack, context, schema, value)) && (!IsPropertyNames(schema) || CheckPropertyNames(stack, context, schema, value)) && (!IsMinProperties(schema) || CheckMinProperties(stack, context, schema, value)) && (!IsMaxProperties(schema) || CheckMaxProperties(stack, context, schema, value))) && (!guard_exports.IsArray(value) || (!IsAdditionalItems(schema) || CheckAdditionalItems(stack, context, schema, value)) && (!IsContains(schema) || CheckContains(stack, context, schema, value)) && (!IsItems(schema) || CheckItems(stack, context, schema, value)) && (!IsMaxContains(schema) || CheckMaxContains(stack, context, schema, value)) && (!IsMaxItems(schema) || CheckMaxItems(stack, context, schema, value)) && (!IsMinContains(schema) || CheckMinContains(stack, context, schema, value)) && (!IsMinItems(schema) || CheckMinItems(stack, context, schema, value)) && (!IsPrefixItems(schema) || CheckPrefixItems(stack, context, schema, value)) && (!IsUniqueItems(schema) || CheckUniqueItems(stack, context, schema, value))) && (!guard_exports.IsString(value) || (!IsMaxLength4(schema) || CheckMaxLength(stack, context, schema, value)) && (!IsMinLength4(schema) || CheckMinLength(stack, context, schema, value)) && (!IsFormat(schema) || CheckFormat(stack, context, schema, value)) && (!IsPattern(schema) || CheckPattern(stack, context, schema, value))) && (!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || (!IsExclusiveMaximum(schema) || CheckExclusiveMaximum(stack, context, schema, value)) && (!IsExclusiveMinimum(schema) || CheckExclusiveMinimum(stack, context, schema, value)) && (!IsMaximum(schema) || CheckMaximum(stack, context, schema, value)) && (!IsMinimum(schema) || CheckMinimum(stack, context, schema, value)) && (!IsMultipleOf2(schema) || CheckMultipleOf(stack, context, schema, value))) && (!IsRef2(schema) || CheckRef(stack, context, schema, value)) && (!IsRecursiveRef(schema) || CheckRecursiveRef(stack, context, schema, value)) && (!IsDynamicRef(schema) || CheckDynamicRef(stack, context, schema, value)) && (!IsConst(schema) || CheckConst(stack, context, schema, value)) && (!IsEnum2(schema) || CheckEnum(stack, context, schema, value)) && (!IsIf(schema) || CheckIf(stack, context, schema, value)) && (!IsNot(schema) || CheckNot(stack, context, schema, value)) && (!IsAllOf(schema) || CheckAllOf(stack, context, schema, value)) && (!IsAnyOf(schema) || CheckAnyOf(stack, context, schema, value)) && (!IsOneOf(schema) || CheckOneOf(stack, context, schema, value)) && (!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || CheckUnevaluatedItems(stack, context, schema, value))) && (!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || CheckUnevaluatedProperties(stack, context, schema, value))) && (!IsRefine2(schema) || CheckRefine(stack, context, schema, value));
    stack.Pop(schema);
    return result;
  }
  function ErrorSchemaPushStack(stack, context, schemaPath, instancePath, schema, value) {
    return context.Push() && ErrorSchema(stack, context, schemaPath, instancePath, schema, value) && context.Pop();
  }
  function ErrorSchema(stack, context, schemaPath, instancePath, schema, value) {
    if (context.AtCapacity())
      return false;
    stack.Push(schema);
    const result = IsSchemaBoolean(schema) ? ErrorSchemaBoolean(stack, context, schemaPath, instancePath, schema, value) : !!(+(!IsType(schema) || ErrorType(stack, context, schemaPath, instancePath, schema, value)) & +(!(guard_exports.IsObject(value) && !guard_exports.IsArray(value)) || !!(+(!IsRequired(schema) || ErrorRequired(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAdditionalProperties(schema) || ErrorAdditionalProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependencies(schema) || ErrorDependencies(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependentRequired(schema) || ErrorDependentRequired(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDependentSchemas(schema) || ErrorDependentSchemas(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPatternProperties(schema) || ErrorPatternProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsProperties(schema) || ErrorProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPropertyNames(schema) || ErrorPropertyNames(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinProperties(schema) || ErrorMinProperties(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxProperties(schema) || ErrorMaxProperties(stack, context, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsArray(value) || !!(+(!IsAdditionalItems(schema) || ErrorAdditionalItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsContains(schema) || ErrorContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsItems(schema) || ErrorItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxContains(schema) || ErrorMaxContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaxItems(schema) || ErrorMaxItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinContains(schema) || ErrorMinContains(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinItems(schema) || ErrorMinItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPrefixItems(schema) || ErrorPrefixItems(stack, context, schemaPath, instancePath, schema, value)) & +(!IsUniqueItems(schema) || ErrorUniqueItems(stack, context, schemaPath, instancePath, schema, value)))) & +(!guard_exports.IsString(value) || !!(+(!IsMaxLength4(schema) || ErrorMaxLength(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinLength4(schema) || ErrorMinLength(stack, context, schemaPath, instancePath, schema, value)) & +(!IsFormat(schema) || ErrorFormat(stack, context, schemaPath, instancePath, schema, value)) & +(!IsPattern(schema) || ErrorPattern(stack, context, schemaPath, instancePath, schema, value)))) & +(!(guard_exports.IsNumber(value) || guard_exports.IsBigInt(value)) || !!(+(!IsExclusiveMaximum(schema) || ErrorExclusiveMaximum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsExclusiveMinimum(schema) || ErrorExclusiveMinimum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMaximum(schema) || ErrorMaximum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMinimum(schema) || ErrorMinimum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsMultipleOf2(schema) || ErrorMultipleOf(stack, context, schemaPath, instancePath, schema, value)))) & +(!IsRef2(schema) || ErrorRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsRecursiveRef(schema) || ErrorRecursiveRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsDynamicRef(schema) || ErrorDynamicRef(stack, context, schemaPath, instancePath, schema, value)) & +(!IsConst(schema) || ErrorConst(stack, context, schemaPath, instancePath, schema, value)) & +(!IsEnum2(schema) || ErrorEnum(stack, context, schemaPath, instancePath, schema, value)) & +(!IsIf(schema) || ErrorIf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsNot(schema) || ErrorNot(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAllOf(schema) || ErrorAllOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsAnyOf(schema) || ErrorAnyOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsOneOf(schema) || ErrorOneOf(stack, context, schemaPath, instancePath, schema, value)) & +(!IsUnevaluatedItems(schema) || (!guard_exports.IsArray(value) || ErrorUnevaluatedItems(stack, context, schemaPath, instancePath, schema, value))) & +(!IsUnevaluatedProperties(schema) || (!guard_exports.IsObject(value) || ErrorUnevaluatedProperties(stack, context, schemaPath, instancePath, schema, value)))) && (!IsRefine2(schema) || ErrorRefine(stack, context, schemaPath, instancePath, schema, value));
    stack.Pop(schema);
    return result;
  }


  var index2 = [0];
  var names = /* @__PURE__ */ new Map();
  var funcs = /* @__PURE__ */ new Map();
  function NextName() {
    return `${index2[0]++}`;
  }
  function CreateName(schema, href) {
    if (!names.has(schema))
      names.set(schema, /* @__PURE__ */ new Map());
    const hrefs = names.get(schema);
    if (hrefs.has(href))
      return hrefs.get(href);
    const name = NextName();
    hrefs.set(href, name);
    return name;
  }
  function CreateCallExpression(context, _schema, name, value) {
    return context.UseUnevaluated() ? emit_exports.Call(`check_${name}`, ["context", value]) : emit_exports.Call(`check_${name}`, [value]);
  }
  function CreateFunctionExpression(stack, context, schema, name) {
    const expression = BuildSchema(stack, context, schema, "value");
    return context.UseUnevaluated() ? emit_exports.ConstDeclaration(`check_${name}`, emit_exports.ArrowFunction(["context", "value"], expression)) : emit_exports.ConstDeclaration(`check_${name}`, emit_exports.ArrowFunction(["value"], expression));
  }
  function ResetFunctions() {
    index2[0] = 0;
    names.clear();
    funcs.clear();
  }
  function GetFunctions() {
    return [...funcs.values()];
  }
  function CreateFunction(stack, context, schema, value) {
    const name = CreateName(schema, stack.LexicalBaseURL());
    const call = CreateCallExpression(context, schema, name, value);
    if (funcs.has(name))
      return call;
    funcs.set(name, "");
    funcs.set(name, CreateFunctionExpression(stack, context, schema, name));
    return call;
  }


  var resolve_exports = {};
  __export(resolve_exports, {
    Base: () => Base2,
    DefaultBase: () => DefaultBase,
    DynamicRef: () => DynamicRef,
    Ref: () => Ref2,
    ResolveDynamicRef: () => ResolveDynamicRef,
    ResolveRecursiveRef: () => ResolveRecursiveRef,
    ResolveRef: () => ResolveRef,
    Resource: () => Resource
  });


  var pointer_exports = {};
  __export(pointer_exports, {
    Delete: () => Delete,
    Get: () => Get4,
    Has: () => Has2,
    Indices: () => Indices,
    Set: () => Set4
  });
  function AssertNotRoot(indices) {
    if (indices.length === 0)
      throw Error("Cannot set root");
  }
  function AssertCanSet(value) {
    if (!guard_exports.IsObject(value))
      throw Error("Cannot set value");
  }
  function AssertIndex(index3) {
    if (guard_exports.IsUnsafePropertyKey(index3))
      throw Error("Pointer contains unsafe property key");
  }
  function AssertIndices(indices) {
    for (const index3 of indices)
      AssertIndex(index3);
  }
  function IsNumericIndex(index3) {
    return /^(0|[1-9]\d*)$/.test(index3);
  }
  function TakeIndexRight(indices) {
    return [
      indices.slice(0, indices.length - 1),
      indices.slice(indices.length - 1)[0]
    ];
  }
  function HasIndex(index3, value) {
    return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, index3);
  }
  function GetIndex(index3, value) {
    return guard_exports.IsObject(value) && !guard_exports.IsUnsafePropertyKey(index3) ? value[index3] : void 0;
  }
  function GetIndices(indices, value) {
    return indices.reduce((value2, index3) => GetIndex(index3, value2), value);
  }
  function Indices(pointer) {
    if (guard_exports.IsEqual(pointer.length, 0))
      return [];
    const indices = pointer.split("/").map((index3) => index3.replace(/~1/g, "/").replace(/~0/g, "~"));
    return indices.length > 0 && indices[0] === "" ? indices.slice(1) : indices;
  }
  function Has2(value, pointer) {
    let current = value;
    return Indices(pointer).every((index3) => {
      if (!HasIndex(index3, current))
        return false;
      current = current[index3];
      return true;
    });
  }
  function Get4(value, pointer) {
    const indices = Indices(pointer);
    return GetIndices(indices, value);
  }
  function Set4(value, pointer, next) {
    const indices = Indices(pointer);
    AssertNotRoot(indices);
    AssertIndices(indices);
    const [head, index3] = TakeIndexRight(indices);
    const parent = GetIndices(head, value);
    AssertCanSet(parent);
    parent[index3] = next;
    return value;
  }
  function Delete(value, pointer) {
    const indices = Indices(pointer);
    AssertNotRoot(indices);
    AssertIndices(indices);
    const [head, index3] = TakeIndexRight(indices);
    const parent = GetIndices(head, value);
    AssertCanSet(parent);
    if (guard_exports.IsArray(parent) && IsNumericIndex(index3)) {
      parent.splice(+index3, 1);
    } else {
      delete parent[index3];
    }
    return value;
  }


  var DefaultBase = "https://json-schema.org";
  function FindDynamicAnchor(schema, name) {
    if (guard_exports.IsObject(schema) && IsDynamicAnchor(schema) && guard_exports.IsEqual(schema.$dynamicAnchor, name)) {
      return schema;
    }
    if (guard_exports.IsObject(schema)) {
      for (const key of guard_exports.Keys(schema)) {
        const result = FindDynamicAnchor(schema[key], name);
        if (result)
          return result;
      }
    }
    return void 0;
  }
  function FindBase(schema, base, target) {
    if (guard_exports.IsEqual(schema, target))
      return base.href;
    const nextBase = IsSchemaObject2(schema) && IsId(schema) ? new URL(schema.$id, base.href) : base;
    if (guard_exports.IsArray(schema)) {
      for (const item of schema) {
        const result = FindBase(item, nextBase, target);
        if (!guard_exports.IsUndefined(result))
          return result;
      }
    } else if (guard_exports.IsObject(schema)) {
      for (const key of guard_exports.Keys(schema)) {
        const result = FindBase(schema[key], nextBase, target);
        if (!guard_exports.IsUndefined(result))
          return result;
      }
    }
    return void 0;
  }
  function MatchId(schema, base, ref) {
    if (guard_exports.IsEqual(schema.$id, ref.hash))
      return schema;
    const absoluteRef = new URL(ref.href, base.href);
    if (guard_exports.IsEqual(base.pathname, absoluteRef.pathname))
      return ref.hash.startsWith("#") ? MatchHash(schema, ref) : schema;
    return void 0;
  }
  function MatchAnchor(schema, base, ref) {
    const absoluteAnchor = new URL(`#${schema.$anchor}`, base.href);
    const absoluteRef = new URL(ref.href, base.href);
    return guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href) ? schema : void 0;
  }
  function MatchDynamicAnchor(schema, base, ref) {
    const absoluteAnchor = new URL(`#${schema.$dynamicAnchor}`, base.href);
    const absoluteRef = new URL(ref.href, base.href);
    const isMatch = guard_exports.IsEqual(absoluteAnchor.href, absoluteRef.href);
    return isMatch ? schema : void 0;
  }
  function MatchHash(schema, ref) {
    if (ref.href.endsWith("#"))
      return schema;
    if (!ref.hash.startsWith("#"))
      return void 0;
    const fragment = decodeURIComponent(ref.hash.slice(1));
    if (!fragment.startsWith("/"))
      return void 0;
    const result = pointer_exports.Get(schema, fragment);
    return result;
  }
  function Match4(schema, base, ref) {
    if (IsId(schema)) {
      const result = MatchId(schema, base, ref);
      if (!guard_exports.IsUndefined(result))
        return result;
    }
    if (IsAnchor(schema)) {
      const result = MatchAnchor(schema, base, ref);
      if (!guard_exports.IsUndefined(result))
        return result;
    }
    if (IsDynamicAnchor(schema)) {
      const result = MatchDynamicAnchor(schema, base, ref);
      if (!guard_exports.IsUndefined(result))
        return result;
    }
    return MatchHash(schema, ref);
  }
  function FromArray6(schema, base, ref) {
    return schema.reduce((result, item) => {
      const match2 = FromValue3(item, base, ref);
      return !guard_exports.IsUndefined(match2) ? match2 : result;
    }, void 0);
  }
  function SkipProperty(key) {
    return guard_exports.IsEqual(key, "const") || guard_exports.IsEqual(key, "enum");
  }
  function FromObject10(schema, base, ref) {
    return guard_exports.Keys(schema).reduce((result, key) => {
      if (SkipProperty(key))
        return result;
      const match2 = FromValue3(schema[key], base, ref);
      return !guard_exports.IsUndefined(match2) ? match2 : result;
    }, void 0);
  }
  function FromValue3(schema, base, ref) {
    const nextBase = IsSchemaObject2(schema) && IsId(schema) ? new URL(schema.$id, base.href) : base;
    if (IsSchemaObject2(schema)) {
      const result = Match4(schema, nextBase, ref);
      if (!guard_exports.IsUndefined(result))
        return result;
    }
    if (guard_exports.IsArray(schema))
      return FromArray6(schema, nextBase, ref);
    if (guard_exports.IsObject(schema))
      return FromObject10(schema, nextBase, ref);
    return void 0;
  }
  function Base2(schema, base, target) {
    return FindBase(schema, new URL(base || ".", DefaultBase), target);
  }
  function Resource(context, schema, base, ref) {
    const result = Ref2(context, schema, base, ref, false);
    return IsSchemaObject2(result) && IsId(result) ? result : void 0;
  }
  function CanonicalHref(url) {
    return url.href.split("#")[0];
  }
  function RefContext(context, ref) {
    return guard_exports.HasPropertyKey(context, ref) ? context[ref] : void 0;
  }
  function RefLocal(schema, base, ref) {
    return FromValue3(schema, base, ref);
  }
  function RefRemote(context, base, ref) {
    const canonicalHref = CanonicalHref(ref);
    if (guard_exports.IsEqual(canonicalHref, CanonicalHref(base)))
      return void 0;
    if (!guard_exports.HasPropertyKey(context, canonicalHref))
      return void 0;
    const remoteSchema = context[canonicalHref];
    const remoteBase = IsSchemaObject2(remoteSchema) && IsId(remoteSchema) ? new URL(remoteSchema.$id, canonicalHref) : new URL(canonicalHref);
    const result = guard_exports.IsEqual(ref.hash, "") ? remoteSchema : FromValue3(remoteSchema, remoteBase, ref);
    return result;
  }
  function LegacyRetrievedResource(root, lexicalSchema, referenceBase, ref, schema) {
    if (!ref.$ref.startsWith("#"))
      return void 0;
    if (guard_exports.HasPropertyKey(root, "$schema"))
      return void 0;
    const targetBase = Base2(lexicalSchema, referenceBase, schema);
    if (guard_exports.IsUndefined(targetBase) || guard_exports.IsEqual(targetBase, referenceBase))
      return void 0;
    return { target: schema, base: targetBase, root: lexicalSchema };
  }
  function RemoteRetrievedResource(context, canonical, schema) {
    const remoteRoot = context[canonical];
    if (!IsSchemaObject2(remoteRoot))
      return void 0;
    return { target: schema, base: canonical, root: remoteRoot };
  }
  function FindRetrievedResource(stackframe, ref, schema, canonical, isRemote) {
    const remote = isRemote ? RemoteRetrievedResource(stackframe.context, canonical, schema) : void 0;
    if (!guard_exports.IsUndefined(remote))
      return remote;
    return LegacyRetrievedResource(stackframe.root, stackframe.lexicalSchema, stackframe.referenceBase, ref, schema);
  }
  function FindResolvedResource(context, root, referenceBase, canonical, schema, ids) {
    if (IsId(schema))
      return void 0;
    const resource = Resource(context, root, referenceBase, canonical);
    if (!resource || ids.includes(resource))
      return void 0;
    return { target: schema, resource };
  }
  function Ref2(remotes, schema, base, ref, applySchemaId = true) {
    const initialBase = new URL(base || ".", DefaultBase);
    const resolvedBase = applySchemaId && IsId(schema) ? new URL(schema.$id, initialBase) : initialBase;
    const initialRef = new URL(ref, resolvedBase.href);
    return RefContext(remotes, ref) ?? RefLocal(schema, resolvedBase, initialRef) ?? RefRemote(remotes, resolvedBase, initialRef);
  }
  function DynamicRef(context, root, base, schema, dynamicRef, dynamicAnchors) {
    const initialBase = new URL(base || ".", DefaultBase);
    const fragmentRoot = dynamicRef.$dynamicRef.startsWith("#") ? schema : root;
    const fragmentTarget = Ref2(context, fragmentRoot, base, dynamicRef.$dynamicRef, false);
    if (guard_exports.IsUndefined(fragmentTarget)) {
      const fragment2 = new URL(dynamicRef.$dynamicRef, initialBase).hash;
      if (!fragment2.startsWith("#/") && fragment2.startsWith("#")) {
        const name = decodeURIComponent(fragment2.slice(1));
        const anchorTarget2 = dynamicAnchors.find((anchor) => guard_exports.IsEqual(anchor.$dynamicAnchor, name)) ?? FindDynamicAnchor(root, name);
        return anchorTarget2;
      }
      return void 0;
    }
    if (!IsSchemaObject2(fragmentTarget) || !IsDynamicAnchor(fragmentTarget))
      return fragmentTarget;
    const fragment = new URL(dynamicRef.$dynamicRef, initialBase).hash;
    if (fragment.startsWith("#/"))
      return fragmentTarget;
    const anchorTarget = dynamicAnchors.find((anchor) => guard_exports.IsEqual(anchor.$dynamicAnchor, fragmentTarget.$dynamicAnchor));
    return anchorTarget ?? fragmentTarget;
  }
  function ResolveRef(stackframe, ref) {
    const source = stackframe.inRetrievedFrame ? stackframe.lexicalSchema : stackframe.root;
    const refRoot = ref.$ref.startsWith("#") ? stackframe.lexicalSchema : source;
    const schema = Ref2(stackframe.context, refRoot, stackframe.referenceBase, ref.$ref, false);
    if (!schema || !IsSchemaObject2(schema))
      return { schema };
    const canonical = new URL(ref.$ref, stackframe.referenceBase).href.split("#")[0];
    const isRemote = !guard_exports.IsEqual(canonical, stackframe.resourceBase);
    const retrievedResource = FindRetrievedResource(stackframe, ref, schema, canonical, isRemote);
    const resolvedResource = isRemote ? FindResolvedResource(stackframe.context, stackframe.root, stackframe.referenceBase, canonical, schema, stackframe.ids) : void 0;
    return { schema, retrievedResource, resolvedResource };
  }
  function ResolveRecursiveRef(stackframe, recursiveRef) {
    const refRoot = IsRecursiveAnchorTrue(stackframe.lexicalSchema) ? stackframe.recursiveAnchors[0] : stackframe.lexicalSchema;
    return Ref2(stackframe.context, refRoot, stackframe.lexicalBase, recursiveRef.$recursiveRef, false);
  }
  function ResolveDynamicRef(stackframe, dynamicRef) {
    return DynamicRef(stackframe.context, stackframe.root, stackframe.lexicalBase, stackframe.lexicalSchema, dynamicRef, stackframe.dynamicAnchors);
  }


  var __classPrivateFieldGet = function(receiver, state2, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state2 === "function" ? receiver !== state2 || !f : !state2.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state2.get(receiver);
  };
  var _Stack_instances;
  var _Stack_StackFrame;
  var _Stack_ApplyRefResult;
  var _Stack_BuildBase;
  var _Stack_ResourceBaseURL;
  var _Stack_ReferenceBaseURL;
  var _Stack_LexicalSchema;
  var _Stack_RegisterResourceAnchorArray;
  var _Stack_UnregisterResourceAnchorArray;
  var _Stack_RegisterResourceAnchors;
  var _Stack_UnregisterResourceAnchors;
  var _Stack_RegisterResource;
  var _Stack_UnregisterResource;
  var _Stack_EnterResolvedResource;
  var _Stack_ExitResolvedResource;
  var Stack = class {
    constructor(context, schema) {
      _Stack_instances.add(this);
      this.context = context;
      this.schema = schema;
      this.ids = [];
      this.resourceIds = [];
      this.anchors = [];
      this.recursiveAnchors = [];
      this.dynamicAnchors = [];
      this.retrievedResources = /* @__PURE__ */ new Map();
      this.retrievedFrames = [];
      this.resolvedResources = /* @__PURE__ */ new Map();
      this.pendingResource = true;
    }
    // ----------------------------------------------------------------
    // LexicalBaseURL
    // ----------------------------------------------------------------
    LexicalBaseURL() {
      return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_BuildBase).call(this, this.ids);
    }
    // ----------------------------------------------------------------
    // Push
    // ----------------------------------------------------------------
    Push(schema) {
      if (!IsSchemaObject2(schema))
        return;
      if (IsId(schema))
        __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResource).call(this, schema);
      if (IsAnchor(schema))
        this.anchors.push(schema);
      if (IsRecursiveAnchorTrue(schema))
        this.recursiveAnchors.push(schema);
      if (IsDynamicAnchor(schema))
        this.dynamicAnchors.push(schema);
      const retrievedResource = this.retrievedResources.get(schema);
      if (retrievedResource) {
        this.retrievedFrames.push({
          schema: retrievedResource.root,
          base: retrievedResource.base,
          idDepth: this.ids.length,
          resourceDepth: this.resourceIds.length
        });
      }
    }
    // ----------------------------------------------------------------
    // Pop
    // ----------------------------------------------------------------
    Pop(schema) {
      if (!IsSchemaObject2(schema))
        return;
      if (IsId(schema))
        __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResource).call(this, schema);
      if (IsAnchor(schema))
        this.anchors.pop();
      if (IsRecursiveAnchorTrue(schema))
        this.recursiveAnchors.pop();
      if (IsDynamicAnchor(schema))
        this.dynamicAnchors.pop();
      if (this.retrievedResources.has(schema))
        this.retrievedFrames.pop();
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ExitResolvedResource).call(this, schema);
    }
    // ----------------------------------------------------------------
    // Ref
    // ----------------------------------------------------------------
    Ref(ref) {
      const result = resolve_exports.ResolveRef(__classPrivateFieldGet(this, _Stack_instances, "m", _Stack_StackFrame).call(this), ref);
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ApplyRefResult).call(this, result);
      return result.schema;
    }
    // ----------------------------------------------------------------
    // RecursiveRef
    // ----------------------------------------------------------------
    RecursiveRef(recursiveRef) {
      const result = resolve_exports.ResolveRecursiveRef(__classPrivateFieldGet(this, _Stack_instances, "m", _Stack_StackFrame).call(this), recursiveRef);
      if (result)
        this.pendingResource = true;
      return result;
    }
    // ----------------------------------------------------------------
    // DynamicRef
    // ----------------------------------------------------------------
    DynamicRef(dynamicRef) {
      const result = resolve_exports.ResolveDynamicRef(__classPrivateFieldGet(this, _Stack_instances, "m", _Stack_StackFrame).call(this), dynamicRef);
      if (result)
        this.pendingResource = true;
      return result;
    }
  };
  _Stack_instances = /* @__PURE__ */ new WeakSet(), _Stack_StackFrame = function _Stack_StackFrame2() {
    return {
      context: this.context,
      root: this.schema,
      ids: this.ids,
      lexicalSchema: __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_LexicalSchema).call(this),
      lexicalBase: this.LexicalBaseURL(),
      referenceBase: __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ReferenceBaseURL).call(this),
      resourceBase: __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ResourceBaseURL).call(this),
      recursiveAnchors: this.recursiveAnchors,
      dynamicAnchors: this.dynamicAnchors,
      inRetrievedFrame: this.retrievedFrames.length > 0
    };
  }, _Stack_ApplyRefResult = function _Stack_ApplyRefResult2(result) {
    if (!guard_exports.IsUndefined(result.schema))
      this.pendingResource = true;
    if (!guard_exports.IsUndefined(result.resolvedResource)) {
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_EnterResolvedResource).call(this, result.resolvedResource.target, result.resolvedResource.resource);
    }
    if (!guard_exports.IsUndefined(result.retrievedResource)) {
      this.retrievedResources.set(result.retrievedResource.target, {
        base: result.retrievedResource.base,
        root: result.retrievedResource.root
      });
    }
  }, _Stack_BuildBase = function _Stack_BuildBase2(stack) {
    const frame = this.retrievedFrames[this.retrievedFrames.length - 1];
    const base = frame ? new URL(frame.base) : new URL(resolve_exports.DefaultBase);
    const scoped = frame ? stack.slice(frame.idDepth) : stack;
    return scoped.reduce((result, schema) => new URL(schema.$id, result), base).href;
  }, _Stack_ResourceBaseURL = function _Stack_ResourceBaseURL2() {
    const frame = this.retrievedFrames[this.retrievedFrames.length - 1];
    if (!frame)
      return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_BuildBase).call(this, this.resourceIds);
    return this.resourceIds.slice(frame.resourceDepth).reduce((result, schema) => new URL(schema.$id, result), new URL(frame.base)).href;
  }, _Stack_ReferenceBaseURL = function _Stack_ReferenceBaseURL2() {
    if (this.retrievedFrames.length > 0)
      return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ResourceBaseURL).call(this);
    const lexical = this.ids[this.ids.length - 1];
    if (lexical && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(lexical.$id))
      return this.LexicalBaseURL();
    return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_ResourceBaseURL).call(this);
  }, _Stack_LexicalSchema = function _Stack_LexicalSchema2() {
    const frame = this.retrievedFrames[this.retrievedFrames.length - 1];
    if (frame)
      return this.ids.length > frame.idDepth ? this.ids[this.ids.length - 1] : frame.schema;
    return this.ids.length > 0 ? this.ids[this.ids.length - 1] : this.schema;
  }, _Stack_RegisterResourceAnchorArray = function _Stack_RegisterResourceAnchorArray2(schema) {
    schema.forEach((schema2) => __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResourceAnchors).call(this, schema2, false));
  }, _Stack_UnregisterResourceAnchorArray = function _Stack_UnregisterResourceAnchorArray2(schema) {
    schema.forEach((schema2) => __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResourceAnchors).call(this, schema2, false));
  }, _Stack_RegisterResourceAnchors = function _Stack_RegisterResourceAnchors2(schema, isRoot = true) {
    if (IsSchemaBoolean(schema))
      return;
    if (guard_exports.IsArray(schema))
      return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResourceAnchorArray).call(this, schema);
    if (!IsSchemaObject2(schema))
      return;
    const current = schema;
    if (!isRoot && IsId(current))
      return;
    if (!isRoot && IsDynamicAnchor(current))
      this.dynamicAnchors.push(current);
    for (const key of guard_exports.Keys(current))
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResourceAnchors2).call(this, current[key], false);
  }, _Stack_UnregisterResourceAnchors = function _Stack_UnregisterResourceAnchors2(schema, isRoot = true) {
    if (IsSchemaBoolean(schema))
      return;
    if (guard_exports.IsArray(schema))
      return __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResourceAnchorArray).call(this, schema);
    if (!IsSchemaObject2(schema))
      return;
    const current = schema;
    if (!isRoot && IsId(current))
      return;
    if (!isRoot && IsDynamicAnchor(current))
      this.dynamicAnchors.pop();
    for (const key of guard_exports.Keys(current))
      __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResourceAnchors2).call(this, current[key], false);
  }, _Stack_RegisterResource = function _Stack_RegisterResource2(schema) {
    this.ids.push(schema);
    const isResource = this.pendingResource;
    this.pendingResource = false;
    if (isResource)
      this.resourceIds.push(schema);
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResourceAnchors).call(this, schema, true);
  }, _Stack_UnregisterResource = function _Stack_UnregisterResource2(schema) {
    this.ids.pop();
    const isResource = this.resourceIds.length > 0 && guard_exports.IsEqual(this.resourceIds[this.resourceIds.length - 1], schema);
    if (isResource)
      this.resourceIds.pop();
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResourceAnchors).call(this, schema, true);
  }, _Stack_EnterResolvedResource = function _Stack_EnterResolvedResource2(target, resource) {
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_RegisterResource).call(this, resource);
    this.resolvedResources.set(target, resource);
  }, _Stack_ExitResolvedResource = function _Stack_ExitResolvedResource2(target) {
    if (!this.resolvedResources.has(target))
      return;
    const resource = this.resolvedResources.get(target);
    __classPrivateFieldGet(this, _Stack_instances, "m", _Stack_UnregisterResource).call(this, resource);
    this.resolvedResources.delete(target);
  };


  function CreateCode(build) {
    const functions = build.Functions().join(";\n");
    const statements = build.UseUnevaluated() ? ["const context = new CheckContext({}, {})", `return ${build.Entry()}`] : [`return ${build.Entry()}`];
    return `${functions}; return (value) => { ${statements.join("; ")} }`;
  }
  function CreateEvaluatedCheck(build, code) {
    const factory = environment_exports.Evaluate("CheckContext", "Guard", "Format", "Hashing", build.External().identifier, code);
    return factory(CheckContext, guard_exports, format_exports, hash_exports, build.External().variables);
  }
  function CreateDynamicCheck(build) {
    const stack = new Stack(build.Context(), build.Schema());
    const context = new CheckContext();
    return (value) => CheckSchema(stack, context, build.Schema(), value);
  }
  function CreateCheck(build, code) {
    return environment_exports.CanEvaluate() ? CreateEvaluatedCheck(build, code) : CreateDynamicCheck(build);
  }
  var EvaluateResult = class {
    constructor(isAccelerated, code, check) {
      this.isAccelerated = isAccelerated;
      this.code = code;
      this.check = check;
    }
    IsAccelerated() {
      return this.isAccelerated;
    }
    Code() {
      return this.code;
    }
    Check(value) {
      return this.check(value);
    }
  };
  var BuildResult = class {
    constructor(context, schema, external, functions, entry, useUnevaluated) {
      this.context = context;
      this.schema = schema;
      this.external = external;
      this.functions = functions;
      this.entry = entry;
      this.useUnevaluated = useUnevaluated;
    }
    /** Returns the Context used for this build */
    Context() {
      return this.context;
    }
    /** Returns the Schema used for this build */
    Schema() {
      return this.schema;
    }
    /** Returns true if this build requires a Unevaluated context */
    UseUnevaluated() {
      return this.useUnevaluated;
    }
    /** Returns external variables */
    External() {
      return this.external;
    }
    /** Returns check functions */
    Functions() {
      return this.functions;
    }
    /** Return entry function call. */
    Entry() {
      return this.entry;
    }
    /** Evaluates the build into a validation function */
    Evaluate() {
      const code = CreateCode(this);
      const check = CreateCheck(this, code);
      return new EvaluateResult(environment_exports.CanEvaluate(), code, check);
    }
  };
  function Build(...args) {
    const [context, schema] = arguments_exports.Match(args, {
      2: (context2, schema2) => [context2, schema2],
      1: (schema2) => [{}, schema2]
    });
    ResetExternal();
    ResetFunctions();
    const stack = new Stack(context, schema);
    const build = new BuildContext(HasUnevaluated(context, schema));
    const call = CreateFunction(stack, build, schema, "value");
    const functions = GetFunctions();
    const externals = GetExternal();
    return new BuildResult(context, schema, externals, functions, call, build.UseUnevaluated());
  }


  function Errors(...args) {
    const [context, schema, value] = arguments_exports.Match(args, {
      3: (context2, schema2, value2) => [context2, schema2, value2],
      2: (schema2, value2) => [{}, schema2, value2]
    });
    const stack = new Stack(context, schema);
    const errorContext = new ErrorContext();
    const result = ErrorSchema(stack, errorContext, "#", "", schema, value);
    const errors = errorContext.GetErrors();
    const locale2 = Get2();
    const localized = errors.map((error2) => ({ ...error2, message: locale2(error2) }));
    return [result, localized];
  }


  function Check(...args) {
    const [context, schema, value] = arguments_exports.Match(args, {
      3: (context2, schema2, value2) => [context2, schema2, value2],
      2: (schema2, value2) => [{}, schema2, value2]
    });
    const stack = new Stack(context, schema);
    const checkContext = new CheckContext();
    return CheckSchema(stack, checkContext, schema, value);
  }


  function TsIgnore() {
    return `// @ts-ignore`;
  }
  function Separator() {
    return ``;
  }
  function ImportSection(build) {
    const context = build.UseUnevaluated() ? [`import { CheckContext } from "typebox/schema"`] : [];
    const hashing = `import { Hashing } from "typebox/system"`;
    const format3 = `import { Format } from "typebox/format"`;
    const guard = `import { Guard } from "typebox/guard"`;
    return [...context, hashing, format3, guard];
  }
  function ExternalSection(build) {
    const { identifier } = build.External();
    return [
      Separator(),
      TsIgnore(),
      `let ${identifier} = []`,
      Separator(),
      TsIgnore(),
      `export function SetExternal(external) { ${identifier} = external.variables }`
    ];
  }
  function FunctionSection(build) {
    return build.Functions().map((func) => [Separator(), TsIgnore(), `${func};`].join("\n"));
  }
  function ExportSection(build) {
    const body = build.UseUnevaluated() ? `const context = new CheckContext({}, {}); return ${build.Entry()}` : `return ${build.Entry()}`;
    return [
      Separator(),
      TsIgnore(),
      `export function Check(value) { ${body} }`
    ];
  }
  function Code(...args) {
    const [context, type2] = arguments_exports.Match(args, {
      2: (context2, type3) => [context2, type3],
      1: (type3) => [{}, type3]
    });
    const build = Build(context, type2);
    const code = [...ImportSection(build), ...ExternalSection(build), ...FunctionSection(build), ...ExportSection(build)].join("\n");
    return { External: build.External(), Code: code };
  }


  var value_exports2 = {};
  __export(value_exports2, {
    Assert: () => Assert,
    AssertError: () => AssertError,
    Check: () => Check2,
    Clean: () => Clean,
    Clone: () => Clone2,
    Convert: () => Convert,
    Create: () => Create2,
    CreateError: () => CreateError,
    Decode: () => Decode10,
    DecodeError: () => DecodeError,
    DecodeUnsafe: () => DecodeUnsafe,
    Default: () => Default,
    Delete: () => Delete2,
    Diff: () => Diff,
    Edit: () => Edit,
    Encode: () => Encode10,
    EncodeError: () => EncodeError,
    EncodeUnsafe: () => EncodeUnsafe,
    Equal: () => Equal,
    Errors: () => Errors2,
    HasCodec: () => HasCodec,
    Hash: () => Hash2,
    Insert: () => Insert2,
    IsOptionalUndefined: () => IsOptionalUndefined,
    Parse: () => Parse,
    ParseError: () => ParseError,
    Parser: () => Parser,
    Patch: () => Patch,
    Pipeline: () => Pipeline,
    Pointer: () => pointer_exports,
    Repair: () => Repair,
    UnionPrioritySort: () => UnionPrioritySort,
    UnionScoreSelect: () => UnionScoreSelect,
    Update: () => Update2,
    Value: () => value_exports,
    default: () => value_default
  });


  function Check2(...args) {
    const [context, type2, value] = arguments_exports.Match(args, {
      3: (context2, type3, value2) => [context2, type3, value2],
      2: (type3, value2) => [{}, type3, value2]
    });
    return Check(context, type2, value);
  }


  function Errors2(...args) {
    const [context, type2, value] = arguments_exports.Match(args, {
      3: (context2, type3, value2) => [context2, type3, value2],
      2: (type3, value2) => [{}, type3, value2]
    });
    const [_, errors] = Errors(context, type2, value);
    return errors;
  }


  var AssertError = class extends Error {
    constructor(source, value, errors) {
      super(source);
      Object.defineProperty(this, "cause", {
        value: { source, errors, value },
        writable: false,
        configurable: false,
        enumerable: false
      });
    }
  };
  function Assert(...args) {
    const [context, type2, value] = arguments_exports.Match(args, {
      3: (context2, type3, value2) => [context2, type3, value2],
      2: (type3, value2) => [{}, type3, value2]
    });
    const check = Check2(context, type2, value);
    if (!check)
      throw new AssertError("Assert", value, Errors2(context, type2, value));
  }


  function FromArray7(context, type2, value) {
    if (!guard_exports.IsArray(value))
      return value;
    return value.map((value2) => FromType19(context, type2.items, value2));
  }


  function FromCyclic6(context, type2, value) {
    return FromType19({ ...context, ...type2.$defs }, Ref(type2.$ref), value);
  }


  function EvaluateIntersection(context, type2) {
    const additionalProperties = guard_exports.HasPropertyKey(type2, "unevaluatedProperties") ? { additionalProperties: type2.unevaluatedProperties } : {};
    const instantiated = Instantiate(context, type2);
    const evaluated = Evaluate2(instantiated);
    return IsObject3(evaluated) ? With2(evaluated, additionalProperties) : evaluated;
  }
  function FromIntersect6(context, type2, value) {
    const evaluated = EvaluateIntersection(context, type2);
    return FromType19(context, evaluated, value);
  }


  function GetAdditionalProperties(type2) {
    const additionalProperties = guard_exports.HasPropertyKey(type2, "additionalProperties") ? type2.additionalProperties : void 0;
    return additionalProperties;
  }


  function FromObject11(context, type2, value) {
    if (!guard_exports.IsObject(value) || guard_exports.IsArray(value))
      return value;
    const additionalProperties = GetAdditionalProperties(type2);
    for (const key of guard_exports.Keys(value)) {
      if (guard_exports.HasPropertyKey(type2.properties, key)) {
        value[key] = FromType19(context, type2.properties[key], value[key]);
        continue;
      }
      const unknownCheck = (
        // 1. additionalProperties: true
        guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema(additionalProperties) && Check2(context, additionalProperties, value[key])
      );
      if (unknownCheck) {
        value[key] = FromType19(context, additionalProperties, value[key]);
        continue;
      }
      delete value[key];
    }
    return value;
  }


  function FromRecord3(context, type2, value) {
    if (!guard_exports.IsObject(value))
      return value;
    const additionalProperties = GetAdditionalProperties(type2);
    const [recordPattern, recordValue] = [new RegExp(RecordPattern(type2)), RecordValue(type2)];
    for (const key of guard_exports.Keys(value)) {
      if (recordPattern.test(key)) {
        value[key] = FromType19(context, recordValue, value[key]);
        continue;
      }
      const unknownCheck = (
        // 1. additionalProperties: true
        guard_exports.IsBoolean(additionalProperties) && guard_exports.IsEqual(additionalProperties, true) || IsSchema(additionalProperties) && Check2(context, additionalProperties, value[key])
      );
      if (unknownCheck) {
        value[key] = FromType19(context, additionalProperties, value[key]);
        continue;
      }
      delete value[key];
    }
    return value;
  }


  function FromRef5(context, type2, value) {
    return guard_exports.HasPropertyKey(context, type2.$ref) ? FromType19(context, context[type2.$ref], value) : value;
  }


  function FromTuple5(context, schema, value) {
    if (!guard_exports.IsArray(value))
      return value;
    const length = Math.min(value.length, schema.items.length);
    for (let index3 = 0; index3 < length; index3++) {
      value[index3] = FromType19(context, schema.items[index3], value[index3]);
    }
    return guard_exports.IsGreaterThan(value.length, length) ? value.slice(0, length) : value;
  }


  function Clone2(value) {
    return Clone(value);
  }


  function FromUnion9(context, type2, value) {
    for (const schema of type2.anyOf) {
      const clean = FromType19(context, schema, Clone2(value));
      if (Check2(context, schema, clean))
        return clean;
    }
    return value;
  }


  function FromType19(context, type2, value) {
    return IsArray3(type2) ? FromArray7(context, type2, value) : IsCyclic(type2) ? FromCyclic6(context, type2, value) : IsIntersect(type2) ? FromIntersect6(context, type2, value) : IsObject3(type2) ? FromObject11(context, type2, value) : IsRecord(type2) ? FromRecord3(context, type2, value) : IsRef(type2) ? FromRef5(context, type2, value) : IsTuple(type2) ? FromTuple5(context, type2, value) : IsUnion(type2) ? FromUnion9(context, type2, value) : value;
  }


  function Modifiers(type2, next) {
    for (const key of guard_default.Keys(type2)) {
      if (guard_default.HasPropertyKey(next, key))
        continue;
      next[key] = type2[key];
    }
    return next;
  }
  function FromProperties4(properties) {
    const result = {};
    for (const key of guard_default.Keys(properties))
      result[key] = FromType20(properties[key]);
    return result;
  }
  function FromPriorityTypes(types2) {
    return FromTypes6(Priority(types2));
  }
  function FromTypes6(types2) {
    return types2.map((type2) => FromType20(type2));
  }
  function FromType20(type2) {
    const next = IsArray3(type2) ? _Array_(FromType20(type2.items), ArrayOptions(type2)) : IsIntersect(type2) ? Intersect(FromTypes6(type2.allOf)) : IsUnion(type2) ? Union(FromPriorityTypes(type2.anyOf)) : IsObject3(type2) ? _Object_(FromProperties4(type2.properties)) : IsRecord(type2) ? Record(RecordKey(type2), FromType20(RecordValue(type2))) : IsTuple(type2) ? Tuple(FromTypes6(type2.items)) : type2;
    return Modifiers(type2, next);
  }
  function UnionPrioritySort(type2) {
    const result = FromType20(type2);
    return result;
  }


  function Clean(...args) {
    const [context, type2, value] = arguments_exports.Match(args, {
      3: (context2, type3, value2) => [context2, type3, value2],
      2: (type3, value2) => [{}, type3, value2]
    });
    const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type2) : type2;
    return FromType19(context, sorted, value);
  }


  var try_exports = {};
  __export(try_exports, {
    Fail: () => Fail,
    IsOk: () => IsOk,
    Ok: () => Ok,
    TryArray: () => TryArray,
    TryBigInt: () => TryBigInt,
    TryBoolean: () => TryBoolean,
    TryNull: () => TryNull,
    TryNumber: () => TryNumber,
    TryString: () => TryString,
    TryUndefined: () => TryUndefined
  });


  function IsOk(value) {
    return guard_exports.IsObject(value) && guard_exports.HasPropertyKey(value, "value");
  }
  function Ok(value) {
    return { value };
  }
  function Fail() {
    return void 0;
  }


  function TryArray(value) {
    return guard_exports.IsArray(value) ? Ok(value) : Ok([value]);
  }


  function FromBoolean2(value) {
    return guard_exports.IsEqual(value, true) ? Ok(BigInt(1)) : Ok(BigInt(0));
  }
  var bigintPattern = /^-?(0|[1-9]\d*)n$/;
  var decimalPattern = /^-?(0|[1-9]\d*)\.\d+$/;
  var integerPattern = /^-?(0|[1-9]\d*)$/;
  function IsStringBigIntLike(value) {
    return bigintPattern.test(value);
  }
  function IsStringDecimalLike(value) {
    return decimalPattern.test(value);
  }
  function IsStringIntegerLike(value) {
    return integerPattern.test(value);
  }
  function FromString2(value) {
    const lowercase = value.toLowerCase();
    return IsStringBigIntLike(value) ? Ok(BigInt(value.slice(0, value.length - 1))) : IsStringDecimalLike(value) ? Ok(BigInt(value.split(".")[0])) : IsStringIntegerLike(value) ? Ok(BigInt(value)) : guard_exports.IsEqual(lowercase, "false") ? Ok(BigInt(0)) : guard_exports.IsEqual(lowercase, "true") ? Ok(BigInt(1)) : Fail();
  }
  function TryBigInt(value) {
    return guard_exports.IsBigInt(value) ? Ok(value) : guard_exports.IsBoolean(value) ? FromBoolean2(value) : guard_exports.IsNumber(value) ? Ok(BigInt(Math.trunc(value))) : guard_exports.IsNull(value) ? Ok(BigInt(0)) : guard_exports.IsString(value) ? FromString2(value) : guard_exports.IsUndefined(value) ? Ok(BigInt(0)) : Fail();
  }


  function FromBigInt2(value) {
    return guard_exports.IsEqual(value, BigInt(0)) ? Ok(false) : guard_exports.IsEqual(value, BigInt(1)) ? Ok(true) : Fail();
  }
  function FromNumber2(value) {
    return guard_exports.IsEqual(value, 0) ? Ok(false) : guard_exports.IsEqual(value, 1) ? Ok(true) : Fail();
  }
  function FromString3(value) {
    return guard_exports.IsEqual(value.toLowerCase(), "false") ? Ok(false) : guard_exports.IsEqual(value.toLowerCase(), "true") ? Ok(true) : guard_exports.IsEqual(value, "0") ? Ok(false) : guard_exports.IsEqual(value, "1") ? Ok(true) : Fail();
  }
  function TryBoolean(value) {
    return guard_exports.IsBigInt(value) ? FromBigInt2(value) : guard_exports.IsBoolean(value) ? Ok(value) : guard_exports.IsNumber(value) ? FromNumber2(value) : guard_exports.IsNull(value) ? Ok(false) : guard_exports.IsString(value) ? FromString3(value) : guard_exports.IsUndefined(value) ? Ok(false) : Fail();
  }


  function FromBigInt3(value) {
    return guard_exports.IsEqual(value, BigInt(0)) ? Ok(null) : Fail();
  }
  function FromBoolean3(value) {
    return guard_exports.IsEqual(value, false) ? Ok(null) : Fail();
  }
  function FromNumber3(value) {
    return guard_exports.IsEqual(value, 0) ? Ok(null) : Fail();
  }
  function FromString4(value) {
    const lowercase = value.toLowerCase();
    const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
    return predicate ? Ok(null) : Fail();
  }
  function TryNull(value) {
    return guard_exports.IsBigInt(value) ? FromBigInt3(value) : guard_exports.IsBoolean(value) ? FromBoolean3(value) : guard_exports.IsNumber(value) ? FromNumber3(value) : guard_exports.IsNull(value) ? Ok(null) : guard_exports.IsString(value) ? FromString4(value) : guard_exports.IsUndefined(value) ? Ok(null) : Fail();
  }


  var maxBigInt = BigInt(Number.MAX_SAFE_INTEGER);
  var minBigInt = BigInt(Number.MIN_SAFE_INTEGER);
  function FromBigInt4(value) {
    return value <= maxBigInt && value >= minBigInt ? Ok(Number(value)) : Fail();
  }
  function FromBoolean4(value) {
    return Ok(value ? 1 : 0);
  }
  function FromString5(value) {
    const coerced = +value;
    if (guard_exports.IsNumber(coerced))
      return Ok(coerced);
    const lowercase = value.toLowerCase();
    if (guard_exports.IsEqual(lowercase, "false"))
      return Ok(0);
    if (guard_exports.IsEqual(lowercase, "true"))
      return Ok(1);
    const result = TryBigInt(value);
    if (IsOk(result))
      return result.value <= maxBigInt && result.value >= minBigInt ? Ok(Number(result.value)) : Fail();
    return Fail();
  }
  function TryNumber(value) {
    return guard_exports.IsBigInt(value) ? FromBigInt4(value) : guard_exports.IsBoolean(value) ? FromBoolean4(value) : guard_exports.IsNumber(value) ? Ok(value) : guard_exports.IsNull(value) ? Ok(0) : guard_exports.IsString(value) ? FromString5(value) : guard_exports.IsUndefined(value) ? Ok(0) : Fail();
  }


  function TryString(value) {
    return guard_exports.IsBigInt(value) ? Ok(value.toString()) : guard_exports.IsBoolean(value) ? Ok(value.toString()) : guard_exports.IsNumber(value) ? Ok(value.toString()) : guard_exports.IsNull(value) ? Ok("null") : guard_exports.IsString(value) ? Ok(value) : guard_exports.IsUndefined(value) ? Ok("") : Fail();
  }


  function FromBigInt5(value) {
    return guard_exports.IsEqual(value, BigInt(0)) ? Ok(void 0) : Fail();
  }
  function FromBoolean5(value) {
    return guard_exports.IsEqual(value, false) ? Ok(void 0) : Fail();
  }
  function FromNumber4(value) {
    return guard_exports.IsEqual(value, 0) ? Ok(void 0) : Fail();
  }
  function FromString6(value) {
    const lowercase = value.toLowerCase();
    const predicate = guard_exports.IsEqual(lowercase, "undefined") || guard_exports.IsEqual(lowercase, "null") || guard_exports.IsEqual(value, "") || guard_exports.IsEqual(value, "0");
    return predicate ? Ok(void 0) : Fail();
  }
  function TryUndefined(value) {
    return guard_exports.IsBigInt(value) ? FromBigInt5(value) : guard_exports.IsBoolean(value) ? FromBoolean5(value) : guard_exports.IsNumber(value) ? FromNumber4(value) : guard_exports.IsNull(value) ? Ok(void 0) : guard_exports.IsString(value) ? FromString6(value) : guard_exports.IsUndefined(value) ? Ok(value) : Fail();
  }


  function FromArray8(context, type2, value) {
    const result = try_exports.TryArray(value);
    return result.value.map((value2) => FromType21(context, type2.items, value2));
  }


  function FromBigInt6(_context, _type, value) {
    const result = try_exports.TryBigInt(value);
    return try_exports.IsOk(result) ? result.value : value;
  }


  function FromBoolean6(_context, _type, value) {
    const result = try_exports.TryBoolean(value);
    return try_exports.IsOk(result) ? result.value : value;
  }


  function FromCyclic7(context, type2, value) {
    return FromType21({ ...context, ...type2.$defs }, Ref(type2.$ref), value);
  }


  function FromEnum3(context, type2, value) {
    return FromType21(context, Evaluate2(type2), value);
  }


  function FromInteger(_context, _type, value) {
    const result = try_exports.TryNumber(value);
    return try_exports.IsOk(result) ? Math.trunc(result.value) : value;
  }


  function FromIntersect7(context, type2, value) {
    const instantiated = Instantiate(context, type2);
    const evaluated = Evaluate2(instantiated);
    return FromType21(context, evaluated, value);
  }


  function FromLiteralBigInt(_context, type2, value) {
    const result = try_exports.TryBigInt(value);
    return try_exports.IsOk(result) && guard_exports.IsEqual(type2.const, result.value) ? result.value : value;
  }
  function FromLiteralBoolean(_context, type2, value) {
    const result = try_exports.TryBoolean(value);
    return try_exports.IsOk(result) && guard_exports.IsEqual(type2.const, result.value) ? result.value : value;
  }
  function FromLiteralNumber(_context, type2, value) {
    const result = try_exports.TryNumber(value);
    return try_exports.IsOk(result) && guard_exports.IsEqual(type2.const, result.value) ? result.value : value;
  }
  function FromLiteralString(_context, type2, value) {
    const result = try_exports.TryString(value);
    return try_exports.IsOk(result) && guard_exports.IsEqual(type2.const, result.value) ? result.value : value;
  }
  function FromLiteral6(context, type2, value) {
    if (guard_exports.IsEqual(type2.const, value))
      return value;
    return IsLiteralBigInt(type2) ? FromLiteralBigInt(context, type2, value) : IsLiteralBoolean(type2) ? FromLiteralBoolean(context, type2, value) : IsLiteralNumber(type2) ? FromLiteralNumber(context, type2, value) : IsLiteralString(type2) ? FromLiteralString(context, type2, value) : Unreachable();
  }


  function FromNull2(_context, _type, value) {
    const result = try_exports.TryNull(value);
    return try_exports.IsOk(result) ? result.value : value;
  }


  function FromNumber5(_context, _type, value) {
    const result = try_exports.TryNumber(value);
    return try_exports.IsOk(result) ? result.value : value;
  }


  function FromAdditionalProperties(context, entries, additionalProperties, value) {
    const keys = guard_exports.Keys(value);
    for (const [regexp, _] of entries) {
      for (const key of keys) {
        if (!regexp.test(key)) {
          value[key] = FromType21(context, additionalProperties, value[key]);
        }
      }
    }
    return value;
  }


  function IsOptionalUndefined(property, key, value) {
    return IsOptional(property) && guard_exports.IsUndefined(value[key]);
  }


  function FromProperties5(context, type2, value) {
    const entries = guard_exports.EntriesRegExp(type2.properties);
    const keys = guard_exports.Keys(value);
    for (const [regexp, property] of entries) {
      for (const key of keys) {
        if (!regexp.test(key) || IsOptionalUndefined(property, key, value))
          continue;
        value[key] = FromType21(context, property, value[key]);
      }
    }
    return guard_exports.HasPropertyKey(type2, "additionalProperties") && guard_exports.IsObject(type2.additionalProperties) ? FromAdditionalProperties(context, entries, type2.additionalProperties, value) : value;
  }
  function FromObject12(context, type2, value) {
    return guard_exports.IsObjectNotArray(value) ? FromProperties5(context, type2, value) : value;
  }


  function FromPatternProperties(context, type2, value) {
    const entries = guard_exports.EntriesRegExp(type2.patternProperties);
    const keys = guard_exports.Keys(value);
    for (const [regexp, schema] of entries) {
      for (const key of keys) {
        if (regexp.test(key)) {
          value[key] = FromType21(context, schema, value[key]);
        }
      }
    }
    return guard_exports.HasPropertyKey(type2, "additionalProperties") && guard_exports.IsObject(type2.additionalProperties) ? FromAdditionalProperties(context, entries, type2.additionalProperties, value) : value;
  }
  function FromRecord4(context, type2, value) {
    return guard_exports.IsObjectNotArray(value) ? FromPatternProperties(context, type2, value) : value;
  }


  function FromRef6(context, type2, value) {
    return guard_exports.HasPropertyKey(context, type2.$ref) ? FromType21(context, context[type2.$ref], value) : value;
  }


  function FromString7(_context, _type, value) {
    const result = try_exports.TryString(value);
    return try_exports.IsOk(result) ? result.value : value;
  }


  function FromTemplateLiteral4(context, type2, value) {
    return FromType21(context, Evaluate2(type2), value);
  }


  function FromTuple6(context, type2, value) {
    if (!guard_exports.IsArray(value))
      return value;
    for (let index3 = 0; index3 < Math.min(type2.items.length, value.length); index3++) {
      value[index3] = FromType21(context, type2.items[index3], value[index3]);
    }
    return value;
  }


  function FromUndefined2(_context, _type, value) {
    const result = try_exports.TryUndefined(value);
    return try_exports.IsOk(result) ? result.value : value;
  }


  function FromUnion10(context, type2, value) {
    const matched = type2.anyOf.some((type3) => Check2(context, type3, value));
    if (matched)
      return value;
    const candidates = type2.anyOf.map((type3) => FromType21(context, type3, Clone2(value)));
    const selected = candidates.find((value2) => Check2(context, type2, value2));
    return guard_exports.IsUndefined(selected) ? value : selected;
  }


  function FromVoid(_context, _type, value) {
    const result = try_exports.TryUndefined(value);
    return try_exports.IsOk(result) ? void 0 : value;
  }


  function FromType21(context, type2, value) {
    return IsArray3(type2) ? FromArray8(context, type2, value) : IsBigInt3(type2) ? FromBigInt6(context, type2, value) : IsBoolean4(type2) ? FromBoolean6(context, type2, value) : IsCyclic(type2) ? FromCyclic7(context, type2, value) : IsEnum(type2) ? FromEnum3(context, type2, value) : IsInteger3(type2) ? FromInteger(context, type2, value) : IsIntersect(type2) ? FromIntersect7(context, type2, value) : IsLiteral(type2) ? FromLiteral6(context, type2, value) : IsNull3(type2) ? FromNull2(context, type2, value) : IsNumber4(type2) ? FromNumber5(context, type2, value) : IsObject3(type2) ? FromObject12(context, type2, value) : IsRecord(type2) ? FromRecord4(context, type2, value) : IsRef(type2) ? FromRef6(context, type2, value) : IsString4(type2) ? FromString7(context, type2, value) : IsTemplateLiteral(type2) ? FromTemplateLiteral4(context, type2, value) : IsTuple(type2) ? FromTuple6(context, type2, value) : IsUndefined3(type2) ? FromUndefined2(context, type2, value) : IsUnion(type2) ? FromUnion10(context, type2, value) : IsVoid(type2) ? FromVoid(context, type2, value) : value;
  }


  function Convert(...args) {
    const [context, type2, value] = arguments_exports.Match(args, {
      3: (context2, type3, value2) => [context2, type3, value2],
      2: (type3, value2) => [{}, type3, value2]
    });
    return FromType21(context, type2, value);
  }


  function FromArray9(context, type2, value) {
    if (!guard_exports.IsArray(value))
      return value;
    for (let i = 0; i < value.length; i++) {
      value[i] = FromType22(context, type2.items, value[i]);
    }
    return value;
  }


  function FromCyclic8(context, type2, value) {
    return FromType22({ ...context, ...type2.$defs }, Ref(type2.$ref), value);
  }


  function FromDefault(type2, value) {
    if (!guard_exports.IsUndefined(value))
      return value;
    return guard_exports.IsFunction(type2.default) ? type2.default() : Clone2(type2.default);
  }


  function FromIntersect8(context, type2, value) {
    const instantiated = Instantiate(context, type2);
    const evaluated = Evaluate2(instantiated);
    return FromType22(context, evaluated, value);
  }


  function FromObject13(context, type2, value) {
    if (!guard_exports.IsObject(value))
      return value;
    const knownPropertyKeys = guard_exports.Keys(type2.properties);
    for (const key of knownPropertyKeys) {
      const propertyValue = FromType22(context, type2.properties[key], value[key]);
      const isUnassignableUndefined = guard_exports.IsUndefined(propertyValue) && (IsOptional(type2.properties[key]) || !guard_exports.HasPropertyKey(type2.properties[key], "default"));
      if (isUnassignableUndefined)
        continue;
      value[key] = propertyValue;
    }
    if (!IsAdditionalProperties(type2) || guard_exports.IsBoolean(type2.additionalProperties))
      return value;
    for (const key of guard_exports.Keys(value)) {
      if (knownPropertyKeys.includes(key))
        continue;
      value[key] = FromType22(context, type2.additionalProperties, value[key]);
    }
    return value;
  }


  function FromRecord5(context, type2, value) {
    if (!guard_exports.IsObject(value))
      return value;
    const [recordKey, recordValue] = [new RegExp(RecordPattern(type2)), RecordValue(type2)];
    for (const key of guard_exports.Keys(value)) {
      if (!(recordKey.test(key) && IsDefault(recordValue)))
        continue;
      value[key] = FromType22(context, recordValue, value[key]);
    }
    if (!IsAdditionalProperties(type2))
      return value;
    for (const key of guard_exports.Keys(value)) {
      if (recordKey.test(key))
        continue;
      value[key] = FromType22(context, type2.additionalProperties, value[key]);
    }
    return value;
  }


  function FromRef7(context, type2, value) {
    return guard_exports.HasPropertyKey(context, type2.$ref) ? FromType22(context, context[type2.$ref], value) : value;
  }


  function FromTuple7(context, schema, value) {
    if (!guard_exports.IsArray(value))
      return value;
    const [items, max] = [schema.items, Math.max(schema.items.length, value.length)];
    for (let i = 0; i < max; i++) {
      if (i < items.length)
        value[i] = FromType22(context, items[i], value[i]);
    }
    return value;
  }


  function FromUnion11(context, schema, value) {
    for (const inner of schema.anyOf) {
      const result = FromType22(context, inner, Clone2(value));
      if (Check2(context, inner, result)) {
        return result;
      }
    }
    return value;
  }


  function FromType22(context, type2, value) {
    const defaulted = IsDefault(type2) ? FromDefault(type2, value) : value;
    return IsArray3(type2) ? FromArray9(context, type2, defaulted) : IsCyclic(type2) ? FromCyclic8(context, type2, defaulted) : IsIntersect(type2) ? FromIntersect8(context, type2, defaulted) : IsObject3(type2) ? FromObject13(context, type2, defaulted) : IsRecord(type2) ? FromRecord5(context, type2, defaulted) : IsRef(type2) ? FromRef7(context, type2, defaulted) : IsTuple(type2) ? FromTuple7(context, type2, defaulted) : IsUnion(type2) ? FromUnion11(context, type2, defaulted) : defaulted;
  }


  function Default(...args) {
    const [context, type2, value] = arguments_exports.Match(args, {
      3: (context2, type3, value2) => [context2, type3, value2],
      2: (type3, value2) => [{}, type3, value2]
    });
    return FromType22(context, type2, value);
  }


  function Pipeline(pipeline2) {
    return (...args) => {
      const [context, type2, value] = arguments_exports.Match(args, {
        3: (context2, type3, value2) => [context2, type3, value2],
        2: (type3, value2) => [{}, type3, value2]
      });
      return pipeline2.reduce((result, func) => func(context, type2, result), value);
    };
  }


  function Decode3(_context, type2, value) {
    return type2["~codec"].decode(value);
  }
  function Encode3(_context, type2, value) {
    return type2["~codec"].encode(value);
  }
  function Callback(direction, context, type2, value) {
    if (!IsCodec(type2))
      return value;
    return guard_exports.IsEqual(direction, "Decode") ? Decode3(context, type2, value) : Encode3(context, type2, value);
  }


  function Decode4(direction, context, type2, value) {
    if (!guard_exports.IsArray(value))
      return value;
    for (let i = 0; i < value.length; i++) {
      value[i] = FromType23(direction, context, type2.items, value[i]);
    }
    return Callback(direction, context, type2, value);
  }
  function Encode4(direction, context, type2, value) {
    const exterior = Callback(direction, context, type2, value);
    if (!guard_exports.IsArray(exterior))
      return exterior;
    for (let i = 0; i < exterior.length; i++) {
      exterior[i] = FromType23(direction, context, type2.items, exterior[i]);
    }
    return exterior;
  }
  function FromArray10(direction, context, type2, value) {
    return guard_exports.IsEqual(direction, "Decode") ? Decode4(direction, context, type2, value) : Encode4(direction, context, type2, value);
  }


  function FromCyclic9(direction, context, type2, value) {
    value = FromType23(direction, { ...context, ...type2.$defs }, Ref(type2.$ref), value);
    return Callback(direction, context, type2, value);
  }


  function MergeInteriors(interiors) {
    return interiors.reduce((results, interior) => ({ ...results, ...interior }), {});
  }
  function NonMatchingInterior(value, interiors) {
    for (const interior of interiors)
      if (!guard_exports.IsDeepEqual(value, interior))
        return interior;
    return value;
  }
  function Decode5(direction, context, type2, value) {
    if (guard_exports.IsEqual(type2.allOf.length, 0))
      return Callback(direction, context, type2, value);
    const interiors = type2.allOf.map((schema) => FromType23(direction, context, schema, Clean(schema, Clone2(value))));
    const structural = interiors.every((result) => guard_exports.IsObject(result));
    const exterior = structural ? MergeInteriors(interiors) : NonMatchingInterior(value, interiors);
    return Callback(direction, context, type2, exterior);
  }
  function Encode5(direction, context, type2, value) {
    if (guard_exports.IsEqual(type2.allOf.length, 0))
      return Callback(direction, context, type2, value);
    const exterior = Callback(direction, context, type2, value);
    const interiors = type2.allOf.map((schema) => FromType23(direction, context, schema, Clean(schema, Clone2(exterior))));
    const structural = interiors.every((result) => guard_exports.IsObject(result));
    if (structural)
      return MergeInteriors(interiors);
    return NonMatchingInterior(exterior, interiors);
  }
  function FromIntersect9(direction, context, type2, value) {
    return guard_exports.IsEqual(direction, "Decode") ? Decode5(direction, context, type2, value) : Encode5(direction, context, type2, value);
  }


  function Decode6(direction, context, type2, value) {
    if (!guard_exports.IsObjectNotArray(value))
      return value;
    for (const key of guard_exports.Keys(type2.properties)) {
      if (!guard_exports.HasPropertyKey(value, key) || IsOptionalUndefined(type2.properties[key], key, value))
        continue;
      value[key] = FromType23(direction, context, type2.properties[key], value[key]);
    }
    return Callback(direction, context, type2, value);
  }
  function Encode6(direction, context, type2, value) {
    const exterior = Callback(direction, context, type2, value);
    if (!guard_exports.IsObjectNotArray(exterior))
      return exterior;
    for (const key of guard_exports.Keys(type2.properties)) {
      if (!guard_exports.HasPropertyKey(exterior, key) || IsOptionalUndefined(type2.properties[key], key, exterior))
        continue;
      exterior[key] = FromType23(direction, context, type2.properties[key], exterior[key]);
    }
    return exterior;
  }
  function FromObject14(direction, context, type2, value) {
    return guard_exports.IsEqual(direction, "Decode") ? Decode6(direction, context, type2, value) : Encode6(direction, context, type2, value);
  }


  function Decode7(direction, context, type2, value) {
    if (!guard_exports.IsObjectNotArray(value))
      return value;
    const regexp = new RegExp(RecordPattern(type2));
    for (const key of guard_exports.Keys(value)) {
      if (!regexp.test(key))
        continue;
      value[key] = FromType23(direction, context, RecordValue(type2), value[key]);
    }
    return Callback(direction, context, type2, value);
  }
  function Encode7(direction, context, type2, value) {
    const exterior = Callback(direction, context, type2, value);
    if (!guard_exports.IsObjectNotArray(exterior))
      return exterior;
    const regexp = new RegExp(RecordPattern(type2));
    for (const key of guard_exports.Keys(exterior)) {
      if (!regexp.test(key))
        continue;
      exterior[key] = FromType23(direction, context, RecordValue(type2), exterior[key]);
    }
    return exterior;
  }
  function FromRecord6(direction, context, type2, value) {
    return guard_exports.IsEqual(direction, "Decode") ? Decode7(direction, context, type2, value) : Encode7(direction, context, type2, value);
  }


  function ResolveRef2(direction, context, type2, value) {
    return guard_exports.HasPropertyKey(context, type2.$ref) ? FromType23(direction, context, context[type2.$ref], value) : value;
  }
  function FromRef8(direction, context, type2, value) {
    return guard_exports.IsEqual(direction, "Decode") ? Callback(direction, context, type2, ResolveRef2(direction, context, type2, value)) : ResolveRef2(direction, context, type2, Callback(direction, context, type2, value));
  }


  function Decode8(direction, context, type2, value) {
    if (!guard_exports.IsArray(value))
      return value;
    for (let i = 0; i < Math.min(type2.items.length, value.length); i++) {
      value[i] = FromType23(direction, context, type2.items[i], value[i]);
    }
    return Callback(direction, context, type2, value);
  }
  function Encode8(direction, context, type2, value) {
    const exterior = Callback(direction, context, type2, value);
    if (!guard_exports.IsArray(exterior))
      return value;
    for (let i = 0; i < Math.min(type2.items.length, exterior.length); i++) {
      exterior[i] = FromType23(direction, context, type2.items[i], exterior[i]);
    }
    return exterior;
  }
  function FromTuple8(direction, context, type2, value) {
    return guard_exports.IsEqual(direction, "Decode") ? Decode8(direction, context, type2, value) : Encode8(direction, context, type2, value);
  }


  function Decode9(direction, context, type2, value) {
    for (const schema of type2.anyOf) {
      if (!Check2(context, schema, value))
        continue;
      const variant2 = FromType23(direction, context, schema, value);
      return Callback(direction, context, type2, variant2);
    }
    return value;
  }
  function Encode9(direction, context, type2, value) {
    const exterior = Callback(direction, context, type2, value);
    for (const schema of type2.anyOf) {
      const variant2 = FromType23(direction, context, schema, Clone2(exterior));
      if (!Check2(context, schema, variant2))
        continue;
      return variant2;
    }
    return exterior;
  }
  function FromUnion12(direction, context, type2, value) {
    return guard_exports.IsEqual(direction, "Decode") ? Decode9(direction, context, type2, value) : Encode9(direction, context, type2, value);
  }


  function FromType23(direction, context, type2, value) {
    return IsArray3(type2) ? FromArray10(direction, context, type2, value) : IsCyclic(type2) ? FromCyclic9(direction, context, type2, value) : IsIntersect(type2) ? FromIntersect9(direction, context, type2, value) : IsObject3(type2) ? FromObject14(direction, context, type2, value) : IsRecord(type2) ? FromRecord6(direction, context, type2, value) : IsRef(type2) ? FromRef8(direction, context, type2, value) : IsTuple(type2) ? FromTuple8(direction, context, type2, value) : IsUnion(type2) ? FromUnion12(direction, context, type2, value) : Callback(direction, context, type2, value);
  }


  var DecodeError = class extends AssertError {
    constructor(value, errors) {
      super("Decode", value, errors);
    }
  };
  function Assert2(context, type2, value) {
    if (!Check2(context, type2, value))
      throw new DecodeError(value, Errors2(context, type2, value));
    return value;
  }
  function DecodeUnsafe(context, type2, value) {
    const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type2) : type2;
    return FromType23("Decode", context, sorted, value);
  }
  var Decoder = Pipeline([
    (_context, _type, value) => Clone2(value),
    (context, type2, value) => Default(context, type2, value),
    (context, type2, value) => Convert(context, type2, value),
    (context, type2, value) => Clean(context, type2, value),
    (context, type2, value) => Assert2(context, type2, value),
    (context, type2, value) => DecodeUnsafe(context, type2, value)
  ]);
  function Decode10(...args) {
    const [context, type2, value] = arguments_exports.Match(args, {
      3: (context2, type3, value2) => [context2, type3, value2],
      2: (type3, value2) => [{}, type3, value2]
    });
    return Decoder(context, type2, value);
  }


  var EncodeError = class extends AssertError {
    constructor(value, errors) {
      super("Encode", value, errors);
    }
  };
  function Assert3(context, type2, value) {
    if (!Check2(context, type2, value))
      throw new EncodeError(value, Errors2(context, type2, value));
    return value;
  }
  function EncodeUnsafe(context, type2, value) {
    const sorted = settings_exports.Get().unionPrioritySort ? UnionPrioritySort(type2) : type2;
    return FromType23("Encode", context, sorted, value);
  }
  var Encoder = Pipeline([
    (_context, _type, value) => Clone2(value),
    (context, type2, value) => EncodeUnsafe(context, type2, value),
    (context, type2, value) => Default(context, type2, value),
    (context, type2, value) => Convert(context, type2, value),
    (context, type2, value) => Clean(context, type2, value),
    (context, type2, value) => Assert3(context, type2, value)
  ]);
  function Encode10(...args) {
    const [context, type2, value] = arguments_exports.Match(args, {
      3: (context2, type3, value2) => [context2, type3, value2],
      2: (type3, value2) => [{}, type3, value2]
    });
    return Encoder(context, type2, value);
  }


  function FromArray11(context, type2) {
    return IsCodec(type2) || FromType24(context, type2.items);
  }
  function FromCyclic10(context, type2) {
    return IsCodec(type2) || FromRef9({ ...context, ...type2.$defs }, Ref(type2.$ref));
  }
  function FromIntersect10(context, type2) {
    return IsCodec(type2) || type2.allOf.some((type3) => FromType24(context, type3));
  }
  function FromObject15(context, type2) {
    return IsCodec(type2) || guard_exports.Keys(type2.properties).some((key) => {
      return FromType24(context, type2.properties[key]);
    });
  }
  function FromRecord7(context, type2) {
    return IsCodec(type2) || FromType24(context, RecordValue(type2));
  }
  function FromRef9(context, type2) {
    if (visited.has(type2.$ref))
      return false;
    visited.add(type2.$ref);
    return IsCodec(type2) || guard_exports.HasPropertyKey(context, type2.$ref) && FromType24(context, context[type2.$ref]);
  }
  function FromTuple9(context, type2) {
    return IsCodec(type2) || type2.items.some((type3) => FromType24(context, type3));
  }
  function FromUnion13(context, type2) {
    return IsCodec(type2) || type2.anyOf.some((type3) => FromType24(context, type3));
  }
  function FromType24(context, type2) {
    return IsArray3(type2) ? FromArray11(context, type2) : IsCyclic(type2) ? FromCyclic10(context, type2) : IsIntersect(type2) ? FromIntersect10(context, type2) : IsObject3(type2) ? FromObject15(context, type2) : IsRecord(type2) ? FromRecord7(context, type2) : IsRef(type2) ? FromRef9(context, type2) : IsTuple(type2) ? FromTuple9(context, type2) : IsUnion(type2) ? FromUnion13(context, type2) : IsCodec(type2);
  }
  var visited = /* @__PURE__ */ new Set();
  function HasCodec(...args) {
    const [context, type2] = arguments_exports.Match(args, {
      2: (context2, type3) => [context2, type3],
      1: (type3) => [{}, type3]
    });
    visited.clear();
    return FromType24(context, type2);
  }


  var CreateError = class extends Error {
    constructor(type2, message) {
      super(message);
      this.type = type2;
    }
  };


  function FromDefault2(_context, schema) {
    return guard_exports.IsFunction(schema.default) ? schema.default(schema) : guard_exports.IsObject(schema.default) ? Clone2(schema.default) : schema.default;
  }


  function FromArray12(context, type2) {
    if (IsUniqueItems(type2) && !IsDefault(type2))
      throw new CreateError(type2, "Arrays with uniqueItems constraints must specify a default annotation");
    const length = IsMinItems(type2) ? type2.minItems : 0;
    return Array.from({ length }, () => FromType25(context, type2.items));
  }


  function FromBigInt7(_context, type2) {
    return IsExclusiveMinimum(type2) ? BigInt(type2.exclusiveMinimum) + BigInt(1) : IsMinimum(type2) ? BigInt(type2.minimum) : BigInt(0);
  }


  function FromBoolean7(_context, _type) {
    return false;
  }


  function FromConstructor2(context, type2) {
    const instanceType = FromType25(context, type2.instanceType);
    return class {
      constructor() {
        Object.assign(this, instanceType);
      }
    };
  }


  function FromCyclic11(context, type2) {
    return FromType25({ ...context, ...type2.$defs }, Ref(type2.$ref));
  }


  function FromEnum4(context, type2) {
    return FromType25(context, Evaluate2(type2));
  }


  function FromFunction2(context, type2) {
    const returnType = FromType25(context, type2.returnType);
    return () => returnType;
  }


  function FromInteger2(_context, type2) {
    return IsExclusiveMinimum(type2) && guard_exports.IsNumber(type2.exclusiveMinimum) ? type2.exclusiveMinimum + 1 : IsMinimum(type2) ? type2.minimum : 0;
  }


  function FromIntersect11(context, type2) {
    const instantiated = Instantiate(context, type2);
    const evaluated = Evaluate2(instantiated);
    return FromType25(context, evaluated);
  }


  function FromLiteral7(_context, type2) {
    return type2.const;
  }


  function FromNever(_context, type2) {
    throw new CreateError(type2, "Cannot create TNever types");
  }


  function FromNull3(_context, _type) {
    return null;
  }


  function FromNumber6(_context, type2) {
    return IsExclusiveMinimum(type2) && guard_exports.IsNumber(type2.exclusiveMinimum) ? type2.exclusiveMinimum + 1 : IsMinimum(type2) ? type2.minimum : 0;
  }


  function FromObject16(context, type2) {
    const required = guard_exports.IsUndefined(type2.required) ? [] : type2.required;
    return required.reduce((result, key) => {
      return { ...result, [key]: FromType25(context, type2.properties[key]) };
    }, {});
  }


  function FromRecord8(_context, type2) {
    if (IsMinProperties(type2) && !IsDefault(type2))
      throw new CreateError(type2, "Record with the minProperties constraint must have a default annotation");
    return {};
  }


  function FromRef10(context, type2) {
    return guard_exports.HasPropertyKey(context, type2.$ref) ? FromType25(context, context[type2.$ref]) : (() => {
      throw new CreateError(type2, "Unable to deref Ref");
    })();
  }


  function FromString8(_context, type2) {
    const needsDefault = (IsPattern(type2) || IsFormat(type2)) && !IsDefault(type2);
    if (needsDefault)
      throw Error("Strings with format or pattern constraints must specify default");
    const minLength = IsMinLength4(type2) ? type2.minLength : 0;
    return "".padEnd(minLength);
  }


  function FromSymbol2(_context, _type) {
    return /* @__PURE__ */ Symbol();
  }


  function FromTemplateLiteral5(context, type2) {
    const decoded = TemplateLiteralDecode(type2.pattern);
    if (IsString4(decoded))
      throw new CreateError(type2, "Unable to create TemplateLiteral due to infinite type expansion");
    return FromType25(context, decoded);
  }


  function FromTuple10(context, type2) {
    return Array.from({ length: type2.minItems }, (_, i) => FromType25(context, type2.items[i]));
  }


  function FromUndefined3(_context, _type) {
    return void 0;
  }


  function FromUnion14(context, type2) {
    if (guard_exports.IsEqual(type2.anyOf.length, 0)) {
      throw Error("Unable to create Union with no variants");
    }
    return FromType25(context, type2.anyOf[0]);
  }


  function FromVoid2(_context, _type) {
    return void 0;
  }


  function FromType25(context, type2) {
    return (
      // -----------------------------------------------------
      // Default
      // -----------------------------------------------------
      IsDefault(type2) ? FromDefault2(context, type2) : (
        // -----------------------------------------------------
        // Types
        // -----------------------------------------------------
        IsArray3(type2) ? FromArray12(context, type2) : IsBigInt3(type2) ? FromBigInt7(context, type2) : IsBoolean4(type2) ? FromBoolean7(context, type2) : IsConstructor3(type2) ? FromConstructor2(context, type2) : IsCyclic(type2) ? FromCyclic11(context, type2) : IsEnum(type2) ? FromEnum4(context, type2) : IsFunction3(type2) ? FromFunction2(context, type2) : IsInteger3(type2) ? FromInteger2(context, type2) : IsIntersect(type2) ? FromIntersect11(context, type2) : IsLiteral(type2) ? FromLiteral7(context, type2) : IsNever(type2) ? FromNever(context, type2) : IsNull3(type2) ? FromNull3(context, type2) : IsNumber4(type2) ? FromNumber6(context, type2) : IsObject3(type2) ? FromObject16(context, type2) : IsRecord(type2) ? FromRecord8(context, type2) : IsRef(type2) ? FromRef10(context, type2) : IsString4(type2) ? FromString8(context, type2) : IsSymbol3(type2) ? FromSymbol2(context, type2) : IsTemplateLiteral(type2) ? FromTemplateLiteral5(context, type2) : IsTuple(type2) ? FromTuple10(context, type2) : IsUndefined3(type2) ? FromUndefined3(context, type2) : IsUnion(type2) ? FromUnion14(context, type2) : IsVoid(type2) ? FromVoid2(context, type2) : void 0
      )
    );
  }


  function Create2(...args) {
    const [context, type2] = arguments_exports.Match(args, {
      2: (context2, type3) => [context2, type3],
      1: (type3) => [{}, type3]
    });
    return FromType25(context, type2);
  }


  function Equal(left, right) {
    return guard_exports.IsDeepEqual(left, right);
  }


  function Hash2(value) {
    return hash_exports.Hash(value);
  }


  var ParseError = class extends AssertError {
    constructor(value, errors) {
      super("Parse", value, errors);
    }
  };
  function Assert4(context, type2, value) {
    if (!Check2(context, type2, value))
      throw new ParseError(value, Errors2(context, type2, value));
    return value;
  }
  var Parser = Pipeline([
    (_context, _type, value) => Clone2(value),
    (context, type2, value) => Default(context, type2, value),
    (context, type2, value) => Convert(context, type2, value),
    (context, type2, value) => Clean(context, type2, value),
    (context, type2, value) => Assert4(context, type2, value)
  ]);
  function Parse(...args) {
    const [context, type2, value] = arguments_exports.Match(args, {
      3: (context2, type3, value2) => [context2, type3, value2],
      2: (type3, value2) => [{}, type3, value2]
    });
    const checked = Check2(context, type2, value);
    if (checked)
      return value;
    if (settings_exports.Get().correctiveParse)
      return Parser(context, type2, value);
    throw new ParseError(value, Errors2(context, type2, value));
  }


  function CreateUpdate(path2, value) {
    return { type: "update", path: path2, value };
  }
  function CreateInsert(path2, value) {
    return { type: "insert", path: path2, value };
  }
  function CreateDelete(path2) {
    return { type: "delete", path: path2 };
  }
  function AssertCanDiffObject(value) {
    if (guard_exports.IsObject(value) && guard_exports.IsEqual(guard_exports.Symbols(value).length, 0))
      return;
    throw new Error("Cannot create diffs for objects with symbols keys");
  }
  function* FromObject17(path2, left, right) {
    if (!guard_exports.IsObject(right) || guard_exports.IsArray(right))
      return yield CreateUpdate(path2, right);
    AssertCanDiffObject(left);
    AssertCanDiffObject(right);
    const leftKeys = guard_exports.Keys(left);
    const rightKeys = guard_exports.Keys(right);
    for (const key of rightKeys) {
      if (guard_exports.HasPropertyKey(left, key))
        continue;
      if (guard_exports.IsUnsafePropertyKey(key))
        continue;
      yield CreateInsert(`${path2}/${key}`, right[key]);
    }
    for (const key of leftKeys) {
      if (!guard_exports.HasPropertyKey(right, key))
        continue;
      if (guard_exports.IsUnsafePropertyKey(key))
        continue;
      if (Equal(left, right))
        continue;
      yield* FromValue4(`${path2}/${key}`, left[key], right[key]);
    }
    for (const key of leftKeys) {
      if (guard_exports.HasPropertyKey(right, key))
        continue;
      if (guard_exports.IsUnsafePropertyKey(key))
        continue;
      yield CreateDelete(`${path2}/${key}`);
    }
  }
  function* FromArray13(path2, left, right) {
    if (!guard_exports.IsArray(right))
      return yield CreateUpdate(path2, right);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      yield* FromValue4(`${path2}/${i}`, left[i], right[i]);
    }
    for (let i = 0; i < right.length; i++) {
      if (i < left.length)
        continue;
      yield CreateInsert(`${path2}/${i}`, right[i]);
    }
    for (let i = left.length - 1; i >= 0; i--) {
      if (i < right.length)
        continue;
      yield CreateDelete(`${path2}/${i}`);
    }
  }
  function* FromTypedArray2(path2, left, right) {
    const typeLeft = globalThis.Object.getPrototypeOf(left).constructor.name;
    const typeRight = globalThis.Object.getPrototypeOf(right).constructor.name;
    const predicate = globals_exports.IsTypeArray(right) && guard_exports.IsEqual(left.length, right.length) && guard_exports.IsEqual(typeLeft, typeRight);
    if (predicate) {
      for (let index3 = 0; index3 < Math.min(left.length, right.length); index3++) {
        yield* FromValue4(`${path2}/${index3}`, left[index3], right[index3]);
      }
    } else {
      return yield CreateUpdate(path2, right);
    }
  }
  function* FromUnknown(path2, left, right) {
    if (left === right)
      return;
    yield CreateUpdate(path2, right);
  }
  function* FromValue4(path2, left, right) {
    return globals_exports.IsTypeArray(left) ? yield* FromTypedArray2(path2, left, right) : guard_exports.IsArray(left) ? yield* FromArray13(path2, left, right) : guard_exports.IsObject(left) ? yield* FromObject17(path2, left, right) : yield* FromUnknown(path2, left, right);
  }
  function Diff(current, next) {
    return [...FromValue4("", current, next)];
  }


  var Insert2 = _Object_({
    type: Literal("insert"),
    path: String2(),
    value: Unknown()
  });
  var Update2 = Object({
    type: Literal("update"),
    path: String2(),
    value: Unknown()
  });
  var Delete2 = _Object_({
    type: Literal("delete"),
    path: String2()
  });
  var Edit = Union([Insert2, Update2, Delete2]);


  function IsRoot(edits) {
    return edits.length > 0 && edits[0].path === "" && edits[0].type === "update";
  }
  function IsEmpty(edits) {
    return edits.length === 0;
  }
  function Patch(current, edits) {
    if (IsRoot(edits))
      return Clone2(edits[0].value);
    if (IsEmpty(edits))
      return Clone2(current);
    const clone = Clone2(current);
    for (const edit of edits) {
      switch (edit.type) {
        case "insert": {
          pointer_exports.Set(clone, edit.path, edit.value);
          break;
        }
        case "update": {
          pointer_exports.Set(clone, edit.path, edit.value);
          break;
        }
        case "delete": {
          pointer_exports.Delete(clone, edit.path);
          break;
        }
      }
    }
    return clone;
  }


  var RepairError = class extends Error {
    constructor(context, type2, value, message) {
      super(message);
      this.context = context;
      this.type = type2;
      this.value = value;
    }
  };


  function MakeUnique(values) {
    const [hashes, result] = [/* @__PURE__ */ new Set(), []];
    for (const value of values) {
      const hash = Hash2(value);
      if (hashes.has(hash))
        continue;
      hashes.add(hash);
      result.push(value);
    }
    return result;
  }
  function FromArray14(context, type2, value) {
    if (Check2(context, type2, value))
      return value;
    const created = guard_exports.IsArray(value) ? value : Create2(context, type2);
    const minimum = IsMinItems(type2) && created.length < type2.minItems ? [...created, ...Array.from({ length: type2.minItems - created.length }, () => Create2(context, type2))] : created;
    const maximum = IsMaxItems(type2) && minimum.length > type2.maxItems ? minimum.slice(0, type2.maxItems) : minimum;
    const repaired = maximum.map((value2) => FromType26(context, type2.items, value2));
    if (!IsUniqueItems(type2) || IsUniqueItems(type2) && !guard_exports.IsEqual(type2.uniqueItems, true))
      return repaired;
    const unique = MakeUnique(repaired);
    if (!Check2(context, type2, unique))
      throw new RepairError(context, type2, value, "Failed to repair Array due to uniqueItems constraint");
    return unique;
  }


  function FromEnum5(context, type2, value) {
    return FromType26(context, Evaluate2(type2), value);
  }


  function FromIntersect12(context, type2, value) {
    const instantiated = Instantiate(context, type2);
    const evaluated = Evaluate2(instantiated);
    return FromType26(context, evaluated, value);
  }


  function FromObject18(context, type2, value) {
    if (Check2(context, type2, value))
      return value;
    if (!guard_exports.IsObjectNotArray(value))
      return Create2(context, type2);
    const required = new Set(guard_exports.IsUndefined(type2.required) ? [] : type2.required);
    const result = {};
    for (const [key, schema] of guard_exports.Entries(type2.properties)) {
      if (!required.has(key) && guard_exports.IsUndefined(value[key]))
        continue;
      result[key] = key in value ? FromType26(context, schema, value[key]) : Create2(context, schema);
    }
    const evaluatedKeys = guard_exports.Keys(type2.properties);
    if (IsAdditionalProperties(type2) && guard_exports.IsObject(type2.additionalProperties)) {
      for (const key of guard_exports.Keys(value)) {
        if (evaluatedKeys.includes(key))
          continue;
        result[key] = FromType26(context, type2.additionalProperties, value[key]);
      }
    }
    return result;
  }


  function FromRecord9(context, type2, value) {
    if (Check2(context, type2, value))
      return value;
    if (guard_exports.IsNull(value) || !guard_exports.IsObject(value) || guard_exports.IsArray(value))
      return Create2(context, type2);
    const recordKey = new RegExp(RecordPattern(type2));
    const recordValue = RecordValue(type2);
    const evaluatedKeys = /* @__PURE__ */ new Set();
    const result = {};
    for (const [key, value_] of guard_exports.Entries(value)) {
      if (!recordKey.test(key))
        continue;
      result[key] = FromType26(context, recordValue, value_);
      evaluatedKeys.add(key);
    }
    if (IsAdditionalProperties(type2)) {
      for (const key of guard_exports.Keys(value)) {
        if (evaluatedKeys.has(key))
          continue;
        result[key] = FromType26(context, type2.additionalProperties, value[key]);
      }
    }
    return result;
  }


  function FromRef11(context, type2, value) {
    return guard_exports.HasPropertyKey(context, type2.$ref) ? FromType26(context, context[type2.$ref], value) : (() => {
      throw new RepairError(context, type2, value, "Unable to de-reference target type");
    })();
  }


  function FromTemplateLiteral6(context, type2, value) {
    const decoded = TemplateLiteralDecode(type2.pattern);
    return FromType26(context, decoded, value);
  }


  function FromTuple11(context, schema, value) {
    if (Check2(context, schema, value))
      return value;
    if (!guard_exports.IsArray(value))
      return Create2(context, schema);
    return schema.items.map((schema2, index3) => FromType26(context, schema2, value[index3]));
  }


  function Deref(context, type2, value) {
    return IsRef(type2) ? guard_exports.HasPropertyKey(context, type2.$ref) ? Deref(context, context[type2.$ref], value) : (() => {
      throw new Error("Unable to Deref target");
    })() : type2;
  }
  function ScoreVariant(context, type2, value) {
    if (!(IsObject3(type2) && guard_exports.IsObject(value)))
      return 0;
    const keys = guard_exports.Keys(value);
    const entries = guard_exports.Entries(type2.properties);
    return entries.reduce((result, [key, schema]) => {
      const literal = IsLiteral(schema) && guard_exports.IsEqual(schema.const, value[key]) ? 100 : 0;
      const checks = Check2(context, schema, value[key]) ? 10 : 0;
      const exists = keys.includes(key) ? 1 : 0;
      return result + (literal + checks + exists);
    }, 0);
  }
  function UnionScoreSelect(context, type2, value) {
    const schemas = type2.anyOf.map((schema) => Deref(context, schema, value));
    let [select, best] = [schemas[0], 0];
    for (const schema of schemas) {
      const score = ScoreVariant(context, schema, value);
      if (score > best) {
        select = schema;
        best = score;
      }
    }
    return select;
  }


  function RepairUnion(context, type2, value) {
    const union = Union(Flatten(type2.anyOf));
    const schema = UnionScoreSelect(context, union, value);
    return FromType26(context, schema, value);
  }
  function FromUnion15(context, type2, value) {
    if (Check2(context, type2, value))
      return Clone2(value);
    if (IsDefault(type2))
      return Create2(context, type2);
    return RepairUnion(context, type2, value);
  }


  function FromUnknown2(context, type2, value) {
    if (Check2(context, type2, value))
      return value;
    const converted = Convert(context, type2, value);
    if (Check2(context, type2, converted))
      return converted;
    return Create2(context, type2);
  }


  function AssertRepairableValue(context, type2, value) {
    const unsupported = globals_exports.IsDate(value) || globals_exports.IsMap(value) || globals_exports.IsSet(value) || globals_exports.IsTypeArray(value) || guard_exports.IsConstructor(value) || guard_exports.IsFunction(value);
    if (unsupported) {
      throw new RepairError(context, type2, value, "Value is not repairable");
    }
  }
  function AssertRepairableType(context, type2, value) {
    const unsupported = IsConstructor3(type2) || IsFunction3(type2) || IsNever(type2);
    if (unsupported) {
      throw new RepairError(context, type2, value, "Type is not repairable");
    }
  }
  function CreateWhenUndefined(context, type2, value) {
    return guard_exports.IsUndefined(value) && !IsUndefined3(type2) ? Create2(context, type2) : value;
  }
  function FinalizeRepair(context, type2, repaired) {
    return IsRefine(type2) ? Check2(context, type2, repaired) ? repaired : Create2(context, type2) : repaired;
  }
  function FromType26(context, type2, value) {
    AssertRepairableValue(context, type2, value);
    AssertRepairableType(context, type2, value);
    const candidate = CreateWhenUndefined(context, type2, value);
    const repaired = IsArray3(type2) ? FromArray14(context, type2, candidate) : IsEnum(type2) ? FromEnum5(context, type2, candidate) : IsIntersect(type2) ? FromIntersect12(context, type2, candidate) : IsObject3(type2) ? FromObject18(context, type2, candidate) : IsRecord(type2) ? FromRecord9(context, type2, candidate) : IsRef(type2) ? FromRef11(context, type2, candidate) : IsTemplateLiteral(type2) ? FromTemplateLiteral6(context, type2, candidate) : IsTuple(type2) ? FromTuple11(context, type2, candidate) : IsUnion(type2) ? FromUnion15(context, type2, candidate) : FromUnknown2(context, type2, candidate);
    return FinalizeRepair(context, type2, repaired);
  }


  function Repair(...args) {
    const [context, type2, value] = arguments_exports.Match(args, {
      3: (context2, type3, value2) => [context2, type3, value2],
      2: (type3, value2) => [{}, type3, value2]
    });
    const repaired = FromType26(context, type2, value);
    Assert(context, type2, repaired);
    return repaired;
  }


  var value_exports = {};
  __export(value_exports, {
    Assert: () => Assert,
    Check: () => Check2,
    Clean: () => Clean,
    Clone: () => Clone2,
    Convert: () => Convert,
    Create: () => Create2,
    Decode: () => Decode10,
    Default: () => Default,
    Diff: () => Diff,
    Encode: () => Encode10,
    Equal: () => Equal,
    Errors: () => Errors2,
    HasCodec: () => HasCodec,
    Hash: () => Hash2,
    Parse: () => Parse,
    Patch: () => Patch,
    Pointer: () => pointer_exports,
    Repair: () => Repair
  });


  var value_default = value_exports;


  var Validator = class {
    /** Constructs a Validator. */
    constructor(context, type2) {
      this.hasCodec = HasCodec(context, type2);
      this.buildResult = Build(context, type2);
      this.evaluateResult = this.buildResult.Evaluate();
    }
    // ----------------------------------------------------------------
    // IsAccelerated
    // ----------------------------------------------------------------
    /** Returns true if this Validator is using JIT acceleration. */
    IsAccelerated() {
      return this.evaluateResult.IsAccelerated();
    }
    // ----------------------------------------------------------------
    // Context & Type
    // ----------------------------------------------------------------
    /** Returns the Context for this validator. */
    Context() {
      return this.buildResult.Context();
    }
    /** Returns the underlying Type used to construct this Validator. */
    Type() {
      return this.buildResult.Schema();
    }
    // ----------------------------------------------------------------
    // Code
    // ----------------------------------------------------------------
    /** Returns the generated code for this validator. */
    Code() {
      return this.evaluateResult.Code();
    }
    // ----------------------------------------------------------------
    // Standard Validator
    // ----------------------------------------------------------------
    /** Performs a type-guard check on the provided value. */
    Check(value) {
      return this.evaluateResult.Check(value);
    }
    /** Validates a value and returns it. Will throw if invalid. */
    Parse(value) {
      const checked = this.Check(value);
      if (checked)
        return value;
      if (settings_exports.Get().correctiveParse)
        return Parser(this.Context(), this.Type(), value);
      throw new ParseError(value, this.Errors(value));
    }
    /** Returns an array of validation errors for the given value. */
    Errors(value) {
      if (this.IsAccelerated() && this.Check(value))
        return [];
      return Errors2(this.Context(), this.Type(), value);
    }
    // ----------------------------------------------------------------
    // Value.* Operations
    // ----------------------------------------------------------------
    /** Cleans a value using the Validator type. */
    Clean(value) {
      return Clean(this.Context(), this.Type(), value);
    }
    /** Converts a value using the Validator type. */
    Convert(value) {
      return Convert(this.Context(), this.Type(), value);
    }
    /** Creates a value using the Validator type. */
    Create() {
      return Create2(this.Context(), this.Type());
    }
    /** Creates defaults using the Validator type. */
    Default(value) {
      return Default(this.Context(), this.Type(), value);
    }
    /** Decodes a value */
    Decode(value) {
      const result = this.hasCodec ? Decode10(this.Context(), this.Type(), value) : this.Parse(value);
      return result;
    }
    /** Encodes a value */
    Encode(value) {
      const result = this.hasCodec ? Encode10(this.Context(), this.Type(), value) : this.Parse(value);
      return result;
    }
  };


  function Compile(...args) {
    const [context, type2] = arguments_exports.Match(args, {
      2: (context2, type3) => [context2, type3],
      1: (type3) => [{}, type3]
    });
    return new Validator(context, type2);
  }


  var compile_default = Compile;


  var node_assert_exports = {};
  __export(node_assert_exports, {
    AssertionError: () => AssertionError,
    deepStrictEqual: () => deepStrictEqual,
    default: () => node_assert_default,
    doesNotThrow: () => doesNotThrow,
    fail_: () => fail_,
    match: () => match,
    notDeepStrictEqual: () => notDeepStrictEqual,
    notStrictEqual: () => notStrictEqual,
    ok: () => ok,
    rejects: () => rejects,
    strictEqual: () => strictEqual,
    throws: () => throws
  });
  var AssertionError = class extends Error {
    constructor(message) {
      super(message);
      this.name = "AssertionError";
    }
  };
  var fail = (message) => {
    throw new AssertionError(message);
  };
  var show = (value) => {
    try {
      return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  var ok = (value, message) => {
    if (!value) fail(message ?? `expected a truthy value, got ${show(value)}`);
  };
  var strictEqual = (actual, expected, message) => {
    if (actual !== expected) {
      fail(message ?? `expected ${show(expected)}, got ${show(actual)}`);
    }
  };
  var notStrictEqual = (actual, expected, message) => {
    if (actual === expected) fail(message ?? `expected a value other than ${show(expected)}`);
  };
  var deepStrictEqual = (actual, expected, message) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(message ?? `expected ${show(expected)}, got ${show(actual)}`);
    }
  };
  var notDeepStrictEqual = (actual, expected, message) => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      fail(message ?? `expected a value other than ${show(expected)}`);
    }
  };
  var match = (value, pattern, message) => {
    if (!pattern.test(value)) fail(message ?? `expected ${show(value)} to match ${pattern}`);
  };
  var throws = (fn, message) => {
    try {
      fn();
    } catch (error2) {
      return error2;
    }
    return fail(message ?? "expected the function to throw");
  };
  var doesNotThrow = (fn, message) => {
    try {
      fn();
    } catch (error2) {
      fail(message ?? `expected the function not to throw, got ${show(error2)}`);
    }
  };
  var rejects = async (promise, message) => {
    try {
      await promise;
    } catch (error2) {
      return error2;
    }
    return fail(message ?? "expected the promise to reject");
  };
  var fail_ = fail;
  var node_assert_default = {
    ok,
    strictEqual,
    notStrictEqual,
    deepStrictEqual,
    notDeepStrictEqual,
    match,
    throws,
    doesNotThrow,
    rejects,
    fail: fail_,
    AssertionError
  };


  var node_async_hooks_exports = {};
  __export(node_async_hooks_exports, {
    AsyncResource: () => AsyncResource,
    asyncResource: () => asyncResource,
    createHook: () => createHook,
    default: () => node_async_hooks_default,
    executionAsyncId: () => executionAsyncId,
    executionAsyncResource: () => executionAsyncResource,
    triggerAsyncId: () => triggerAsyncId
  });
  var createHook = () => ({
    enable: () => void 0,
    disable: () => void 0
  });
  var executionAsyncId = () => 0;
  var triggerAsyncId = () => 0;
  var asyncResource = () => ({
    triggerAsyncId: () => 0
  });
  var executionAsyncResource = () => void 0;
  var AsyncResource = class {
    constructor(_type) {
    }
    runInAsyncScope = (fn) => fn();
    emitDestroy = () => void 0;
  };
  var node_async_hooks_default = {
    createHook,
    executionAsyncId,
    triggerAsyncId,
    asyncResource,
    executionAsyncResource,
    AsyncResource
  };


  var node_buffer_exports = {};
  __export(node_buffer_exports, {
    Buffer: () => Buffer2,
    default: () => node_buffer_default
  });
  var Buffer2 = class _Buffer extends Uint8Array {
    static from(value, encoding) {
      if (value instanceof Uint8Array) return _Buffer.from(value);
      const text = String(value);
      if (encoding === "base64") {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let index3 = 0; index3 < binary.length; index3++) bytes[index3] = binary.charCodeAt(index3);
        return new _Buffer(bytes);
      }
      return new _Buffer(new TextEncoder().encode(text));
    }
    static alloc(size) {
      return new _Buffer(new Uint8Array(size));
    }
    static isBuffer(value) {
      return value instanceof Uint8Array;
    }
    static concat(list) {
      const total = list.reduce((sum, chunk) => sum + chunk.length, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of list) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      return new _Buffer(out);
    }
    toString(encoding) {
      if (encoding === "base64") {
        let binary = "";
        for (const byte of this) binary += String.fromCharCode(byte);
        return btoa(binary);
      }
      return new TextDecoder().decode(this);
    }
    toString(encoding, start2, end) {
      return this.toString(encoding);
    }
  };
  var node_buffer_default = { Buffer: Buffer2 };


  var node_cluster_exports = {};
  __export(node_cluster_exports, {
    default: () => node_cluster_default,
    fork: () => fork,
    isPrimary: () => isPrimary,
    on: () => on
  });
  var isPrimary = true;
  var fork = () => {
    throw new Error("node:cluster is not available in the embedded extension host");
  };
  var on = (_event, _listener) => void 0;
  var node_cluster_default = { isPrimary, fork, on };


  var node_console_exports = {};
  __export(node_console_exports, {
    assert: () => assert,
    debug: () => debug,
    default: () => node_console_default,
    dir: () => dir,
    error: () => error,
    group: () => group,
    groupEnd: () => groupEnd,
    info: () => info,
    log: () => log,
    table: () => table,
    time: () => time,
    timeEnd: () => timeEnd,
    trace: () => trace,
    warn: () => warn
  });
  var console2 = globalThis.console;
  var log = console2.log;
  var info = console2.info;
  var warn = console2.warn;
  var error = console2.error;
  var debug = console2.debug;
  var trace = console2.debug;
  var dir = console2.log;
  var table = console2.log;
  var time = console2.log;
  var timeEnd = console2.log;
  var assert = console2.log;
  var group = console2.log;
  var groupEnd = console2.log;
  var node_console_default = console2;


  var node_crypto_exports = {};
  __export(node_crypto_exports, {
    createHash: () => createHash,
    createHmac: () => createHmac,
    default: () => node_crypto_default,
    getRandomValues: () => getRandomValues,
    randomBytes: () => randomBytes,
    randomUUID: () => randomUUID,
    timingSafeEqual: () => timingSafeEqual
  });
  var HEX = "0123456789abcdef";
  var randomByte = () => Math.floor(Math.random() * 256);
  var randomBytes = (size) => {
    const bytes = new Uint8Array(size);
    for (let index3 = 0; index3 < size; index3++) bytes[index3] = randomByte();
    return bytes;
  };
  var randomUUID = () => {
    let uuid = "";
    for (let index3 = 0; index3 < 36; index3++) {
      if (index3 === 8 || index3 === 13 || index3 === 18 || index3 === 23) {
        uuid += "-";
        continue;
      }
      if (index3 === 14) {
        uuid += "4";
        continue;
      }
      uuid += HEX[randomByte() & 15];
    }
    return uuid;
  };
  var getRandomValues = (array) => {
    for (let index3 = 0; index3 < array.length; index3++) array[index3] = randomByte();
    return array;
  };
  var digest = (input) => {
    let low = 2166136261;
    let high = 16777619;
    for (let index3 = 0; index3 < input.length; index3++) {
      low = Math.imul(low ^ input.charCodeAt(index3), 16777619) >>> 0;
      high = Math.imul(high + input.charCodeAt(index3) + index3, 2246822507) >>> 0;
    }
    return low.toString(16).padStart(8, "0") + high.toString(16).padStart(8, "0");
  };
  var createHash = (_algorithm) => {
    const chunks = [];
    return {
      update(chunk) {
        chunks.push(chunk);
        return chunks;
      },
      digest(encoding) {
        const hex = digest(chunks.join(""));
        if (encoding === "base64") {
          return btoa(hex);
        }
        return hex;
      }
    };
  };
  var createHmac = (_algorithm, _key) => createHash("sha256");
  var timingSafeEqual = (left, right) => {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index3 = 0; index3 < left.length; index3++) difference |= left[index3] ^ right[index3];
    return difference === 0;
  };
  var node_crypto_default = {
    randomBytes,
    randomUUID,
    getRandomValues,
    createHash,
    createHmac,
    timingSafeEqual
  };


  var node_dgram_exports = {};
  __export(node_dgram_exports, {
    createSocket: () => createSocket,
    default: () => node_dgram_default
  });
  var createSocket = (_type) => {
    throw new Error("node:dgram is not available in the embedded extension host");
  };
  var node_dgram_default = { createSocket };


  var node_diagnostics_channel_exports = {};
  __export(node_diagnostics_channel_exports, {
    channel: () => channel,
    default: () => node_diagnostics_channel_default,
    hasSubscribers: () => hasSubscribers,
    publish: () => publish,
    subscribe: () => subscribe
  });
  var channel = (_name) => ({
    subscribe: () => () => void 0,
    publish: () => void 0,
    hasSubscribers: () => false
  });
  var subscribe = (_name, _listener) => () => void 0;
  var publish = (_name, _message) => false;
  var hasSubscribers = (_name) => false;
  var node_diagnostics_channel_default = { channel, subscribe, publish, hasSubscribers };


  var node_dns_exports = {};
  __export(node_dns_exports, {
    default: () => node_dns_default,
    lookup: () => lookup,
    promises: () => promises,
    resolve: () => resolve2
  });
  var lookup = (_hostname, _options, _callback) => void 0;
  var resolve2 = (_hostname, _callback) => void 0;
  var promises = { lookup: async () => ({ address: "127.0.0.1", family: 4 }) };
  var node_dns_default = { lookup, resolve: resolve2, promises };


  var node_events_exports = {};
  __export(node_events_exports, {
    EventEmitter: () => EventEmitter,
    default: () => node_events_default
  });
  var EventEmitter = class {
    listeners = /* @__PURE__ */ new Map();
    on(event, listener) {
      const existing = this.listeners.get(event) ?? [];
      existing.push(listener);
      this.listeners.set(event, existing);
      return this;
    }
    addListener(event, listener) {
      return this.on(event, listener);
    }
    once(event, listener) {
      const wrapper = (...args) => {
        this.off(event, wrapper);
        listener(...args);
      };
      return this.on(event, wrapper);
    }
    off(event, listener) {
      const existing = this.listeners.get(event);
      if (!existing) return this;
      const index3 = existing.indexOf(listener);
      if (index3 >= 0) existing.splice(index3, 1);
      if (existing.length === 0) this.listeners.delete(event);
      return this;
    }
    removeListener(event, listener) {
      return this.off(event, listener);
    }
    removeAllListeners(event) {
      if (event === void 0) this.listeners.clear();
      else this.listeners.delete(event);
      return this;
    }
    listeners(event) {
      return [...this.listeners.get(event) ?? []];
    }
    emit(event, ...args) {
      const existing = this.listeners.get(event);
      if (!existing || existing.length === 0) return false;
      for (const listener of [...existing]) {
        listener(...args);
      }
      return true;
    }
  };
  var node_events_default = { EventEmitter };


  var shim_fs = __toESM(require_node_fs(), 1);
  var shim_fs_promises = __toESM(require_node_fs_promises(), 1);


  var node_http_exports = {};
  __export(node_http_exports, {
    createServer: () => createServer,
    default: () => node_http_default,
    get: () => get,
    request: () => request
  });
  var unavailable2 = (name) => () => {
    throw new Error(`${name} is not available in the embedded extension host`);
  };
  var createServer = unavailable2("createServer");
  var request = unavailable2("request");
  var get = unavailable2("get");
  var node_http_default = { createServer, request, get };


  var node_http2_exports = {};
  __export(node_http2_exports, {
    connect: () => connect,
    createServer: () => createServer2,
    default: () => node_http2_default
  });
  var connect = (_authority, _options) => {
    throw new Error("node:http2 is not available in the embedded extension host");
  };
  var createServer2 = () => {
    throw new Error("node:http2 is not available in the embedded extension host");
  };
  var node_http2_default = { connect, createServer: createServer2 };


  var node_inspector_exports = {};
  __export(node_inspector_exports, {
    close: () => close,
    default: () => node_inspector_default,
    open: () => open
  });
  var open = (_target) => {
    throw new Error("node:inspector is not available in the embedded extension host");
  };
  var close = () => void 0;
  var node_inspector_default = { open, close };


  var node_module_exports = {};
  __export(node_module_exports, {
    Module: () => Module3,
    createRequire: () => createRequire,
    default: () => node_module_default,
    isBuiltin: () => isBuiltin
  });
  var unavailable3 = (name) => () => {
    throw new Error(`${name} is not available in the embedded extension host`);
  };
  var createRequire = unavailable3("createRequire");
  var Module3 = unavailable3("Module");
  var isBuiltin = (name) => name.startsWith("node:") || ["fs", "path", "os", "url", "events", "module"].includes(name);
  var node_module_default = { createRequire, Module: Module3, isBuiltin };


  var node_net_exports = {};
  __export(node_net_exports, {
    Socket: () => Socket,
    connect: () => connect2,
    createConnection: () => createConnection,
    createServer: () => createServer3,
    default: () => node_net_default
  });
  var unavailable4 = (name) => () => {
    throw new Error(`${name} is not available in the embedded extension host`);
  };
  var createServer3 = unavailable4("createServer");
  var connect2 = unavailable4("connect");
  var createConnection = unavailable4("createConnection");
  var Socket = class {
    constructor(_options) {
    }
    on(_event, _listener) {
      return this;
    }
    end() {
      return this;
    }
    destroy() {
      return this;
    }
  };
  var node_net_default = { createServer: createServer3, connect: connect2, createConnection, Socket };


  var node_process_exports = {};
  __export(node_process_exports, {
    argv: () => argv,
    cwd: () => cwd,
    default: () => node_process_default,
    env: () => env,
    exit: () => exit,
    pid: () => pid,
    platform: () => platform2,
    stderr: () => stderr,
    stdout: () => stdout,
    version: () => version2,
    versions: () => versions
  });
  var globals = globalThis;
  var process2 = globals.__piProcess ?? globals.process;
  var env = process2.env;
  var argv = process2.argv;
  var platform2 = process2.platform;
  var pid = process2.pid;
  var version2 = process2.version;
  var versions = process2.versions;
  var cwd = process2.cwd;
  var exit = process2.exit;
  var stdout = process2.stdout;
  var stderr = process2.stderr;
  var node_process_default = process2;


  var node_punycode_exports = {};
  __export(node_punycode_exports, {
    default: () => node_punycode_default,
    toASCII: () => toASCII,
    toUnicode: () => toUnicode
  });
  var toASCII = (domain) => domain;
  var toUnicode = (domain) => domain;
  var node_punycode_default = { toASCII, toUnicode };


  var node_querystring_exports = {};
  __export(node_querystring_exports, {
    default: () => node_querystring_default,
    escape: () => escape,
    parse: () => parse2,
    stringify: () => stringify,
    unescape: () => unescape
  });
  var stringify = (value) => {
    const parts = Object.entries(value).map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`);
    return parts.join("&");
  };
  var parse2 = (text) => {
    const out = {};
    for (const pair of text.split("&")) {
      if (!pair) continue;
      const [key, value = ""] = pair.split("=");
      out[decodeURIComponent(key)] = decodeURIComponent(value);
    }
    return out;
  };
  var escape = (value) => encodeURIComponent(value);
  var unescape = (value) => decodeURIComponent(value);
  var node_querystring_default = { stringify, parse: parse2, escape, unescape };


  var node_readline_exports = {};
  __export(node_readline_exports, {
    createInterface: () => createInterface,
    default: () => node_readline_default
  });
  var createInterface = (options) => {
    const listeners = /* @__PURE__ */ new Map();
    return {
      prompt: () => void 0,
      close: () => void 0,
      on: (event, listener) => {
        const existing = listeners.get(event) ?? [];
        existing.push(listener);
        listeners.set(event, existing);
        return void 0;
      }
    };
  };
  var node_readline_default = { createInterface };


  var node_readline_promises_exports = {};
  __export(node_readline_promises_exports, {
    createInterface: () => createInterface2,
    default: () => node_readline_promises_default
  });
  var createInterface2 = (options) => ({
    question: async () => {
      throw new Error("readline is not available in the embedded extension host");
    },
    close: () => void 0
  });
  var node_readline_promises_default = { createInterface: createInterface2 };


  var node_sqlite_exports = {};
  __export(node_sqlite_exports, {
    DatabaseSync: () => DatabaseSync,
    default: () => node_sqlite_default
  });
  var DatabaseSync = class {
    constructor(_path, _options) {
      throw new Error("node:sqlite is not available in the embedded extension host");
    }
  };
  var node_sqlite_default = { DatabaseSync };


  var node_stream_exports = {};
  __export(node_stream_exports, {
    PassThrough: () => PassThrough,
    Readable: () => Readable,
    Transform: () => Transform,
    Writable: () => Writable,
    default: () => node_stream_default
  });
  var Readable = class {
    constructor(_options) {
    }
    pipe(destination) {
      return destination;
    }
    on(_event, _listener) {
      return this;
    }
    once(_event, _listener) {
      return this;
    }
    removeListener(_event, _listener) {
      return this;
    }
    push(_chunk) {
      return true;
    }
    read() {
      return void 0;
    }
  };
  var Writable = class {
    write(_chunk) {
      return true;
    }
    end(_chunk) {
      return this;
    }
    on(_event, _listener) {
      return this;
    }
  };
  var Transform = class extends Readable {
  };
  var PassThrough = class extends Readable {
  };
  var node_stream_default = { Readable, Writable, Transform, PassThrough };


  var node_stream_promises_exports = {};
  __export(node_stream_promises_exports, {
    default: () => node_stream_promises_default,
    finished: () => finished,
    pipeline: () => pipeline,
    readableToWeb: () => readableToWeb
  });
  var unavailable5 = (name) => () => {
    throw new Error(`${name} is not available in the embedded extension host`);
  };
  var pipeline = unavailable5("pipeline");
  var finished = unavailable5("finished");
  var readableToWeb = unavailable5("readableToWeb");
  var node_stream_promises_default = { pipeline, finished, readableToWeb };


  var node_stream_web_exports = {};
  __export(node_stream_web_exports, {
    ByteLengthQueuingStrategy: () => ByteLengthQueuingStrategy,
    CountQueuingStrategy: () => CountQueuingStrategy,
    ReadableStream: () => ReadableStream,
    TransformStream: () => TransformStream,
    WritableStream: () => WritableStream,
    default: () => node_stream_web_default
  });
  var ReadableStream = class {
    constructor(_source, _strategy) {
    }
    getReader() {
      return { read: async () => ({ done: true }) };
    }
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ done: true, value: void 0 })
      };
    }
  };
  var WritableStream = class {
    constructor(_sink, _strategy) {
    }
    getWriter() {
      return { write: async () => void 0, close: async () => void 0 };
    }
  };
  var TransformStream = class {
    constructor(_transformer, _writableStrategy, _readableStrategy) {
    }
    readable = new ReadableStream();
    writable = new WritableStream();
  };
  var ByteLengthQueuingStrategy = class {
    constructor(_options) {
    }
  };
  var CountQueuingStrategy = class {
    constructor(_options) {
    }
  };
  var node_stream_web_default = {
    ReadableStream,
    WritableStream,
    TransformStream,
    ByteLengthQueuingStrategy,
    CountQueuingStrategy
  };


  var node_string_decoder_exports = {};
  __export(node_string_decoder_exports, {
    StringDecoder: () => StringDecoder,
    default: () => node_string_decoder_default
  });
  var StringDecoder = class {
    decoder = new TextDecoder();
    write(buffer) {
      return this.decoder.decode(buffer, { stream: true });
    }
    end(buffer) {
      return this.decoder.decode(buffer);
    }
    text(buffer, encoding) {
      return this.decoder.decode(buffer);
    }
  };
  var node_string_decoder_default = { StringDecoder };


  var node_sys_exports = {};
  __export(node_sys_exports, {
    arch: () => arch2,
    cpus: () => cpus2,
    default: () => node_sys_default,
    endianness: () => endianness2,
    freemem: () => freemem2,
    platform: () => platform3,
    totalmem: () => totalmem2
  });
  var cpus2 = () => [];
  var endianness2 = () => "LE";
  var platform3 = () => "linux";
  var arch2 = () => "x64";
  var totalmem2 = () => 0;
  var freemem2 = () => 0;
  var node_sys_default = { cpus: cpus2, endianness: endianness2, platform: platform3, arch: arch2, totalmem: totalmem2, freemem: freemem2 };


  var node_timers_exports = {};
  __export(node_timers_exports, {
    default: () => node_timers_default,
    setImmediate: () => setImmediate,
    setInterval: () => setInterval,
    setTimeout: () => setTimeout2
  });
  var unavailable6 = (name) => () => {
    throw new Error(`${name} is not available in the embedded extension host`);
  };
  var setTimeout2 = unavailable6("setTimeout");
  var setInterval = unavailable6("setInterval");
  var setImmediate = unavailable6("setImmediate");
  var node_timers_default = { setTimeout: setTimeout2, setInterval, setImmediate };


  var timers_promises_exports = {};
  __export(timers_promises_exports, {
    default: () => timers_promises_default,
    setImmediate: () => setImmediate2,
    setInterval: () => setInterval2,
    setTimeout: () => setTimeout3
  });
  var immediate = () => Promise.resolve();
  var setTimeout3 = () => immediate();
  var setImmediate2 = immediate;
  var setInterval2 = () => new Promise(() => void 0);
  var timers_promises_default = { setTimeout: setTimeout3, setImmediate: setImmediate2, setInterval: setInterval2 };


  var node_tls_exports = {};
  __export(node_tls_exports, {
    TLSSocket: () => TLSSocket,
    connect: () => connect3,
    createSecureContext: () => createSecureContext,
    default: () => node_tls_default
  });
  var unavailable7 = (name) => () => {
    throw new Error(`${name} is not available in the embedded extension host`);
  };
  var connect3 = unavailable7("connect");
  var createSecureContext = unavailable7("createSecureContext");
  var TLSSocket = class {
    on(_event, _listener) {
      return this;
    }
    end() {
      return this;
    }
    destroy() {
      return this;
    }
  };
  var node_tls_default = { connect: connect3, createSecureContext, TLSSocket };


  var node_trace_events_exports = {};
  __export(node_trace_events_exports, {
    categories: () => categories,
    default: () => node_trace_events_default,
    start: () => start,
    stop: () => stop
  });
  var categories = () => [];
  var start = () => void 0;
  var stop = () => void 0;
  var node_trace_events_default = { categories, start, stop };


  var node_tty_exports = {};
  __export(node_tty_exports, {
    ReadStream: () => ReadStream,
    WriteStream: () => WriteStream,
    default: () => node_tty_default,
    isatty: () => isatty
  });
  var isatty = (stream) => {
    const candidate = stream;
    return candidate?.isTTY === true;
  };
  var ReadStream = class {
    constructor(_path, _options) {
    }
    isTTY = false;
    on(_event, _listener) {
      return this;
    }
    setRawMode(_mode) {
      return this;
    }
    resume() {
      return this;
    }
    pause() {
      return this;
    }
  };
  var WriteStream = class {
    constructor(_fd) {
    }
    isTTY = false;
    write(_chunk) {
      return true;
    }
    on(_event, _listener) {
      return this;
    }
  };
  var node_tty_default = { isatty, ReadStream, WriteStream };


  var node_util_exports = {};
  __export(node_util_exports, {
    _extend: () => _extend,
    callbackify: () => callbackify,
    debuglog: () => debuglog,
    default: () => node_util_default,
    deprecate: () => deprecate,
    format: () => format2,
    inherits: () => inherits,
    inspect: () => inspect,
    isArray: () => isArray,
    isDeepStrictEqual: () => isDeepStrictEqual,
    parseArgs: () => parseArgs,
    promisify: () => promisify,
    types: () => types
  });
  var format2 = (first, ...rest) => {
    if (typeof first !== "string") {
      return [first, ...rest].map((value) => String(value)).join(" ");
    }
    let index3 = 0;
    const formatted = first.replace(/%[sdjioO%]/g, (token) => {
      if (token === "%%") return "%";
      if (index3 >= rest.length) return token;
      const value = rest[index3++];
      switch (token) {
        case "%s":
          return typeof value === "string" ? value : String(value);
        case "%d":
          return String(Number(value));
        case "%j":
          try {
            return JSON.stringify(value) ?? "undefined";
          } catch {
            return "[Circular]";
          }
        default:
          return typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
      }
    });
    const trailing = rest.slice(index3).map((value) => String(value));
    return trailing.length > 0 ? `${formatted} ${trailing.join(" ")}` : formatted;
  };
  var promisify = (fn) => (...args) => new Promise((resolve3, reject) => {
    fn(...args, (error2, value) => {
      if (error2) reject(error2);
      else resolve3(value);
    });
  });
  var inspect = (value) => {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };
  var deprecate = (fn) => fn;
  var debuglog = (_section, _callback) => () => void 0;
  var callbackify = (fn) => fn;
  var inherits = (constructor, superConstructor) => {
    const child = constructor;
    const parent = superConstructor;
    child.super_ = parent.prototype;
  };
  var isArray = Array.isArray;
  var isDeepStrictEqual = (left, right) => {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  };
  var _extend = (target, source) => {
    Object.assign(target, source);
    return target;
  };
  var types = {
    isDate: (value) => value instanceof Date,
    isRegExp: (value) => value instanceof RegExp,
    isPromise: (value) => typeof value === "object" && value !== null && "then" in value
  };
  var parseArgs = (options) => {
    const spec = options ?? {};
    const values = {};
    for (const [name, option] of Object.entries(spec.options ?? {})) {
      if (option?.type === "boolean") values[name] = false;
    }
    return { values };
  };
  var node_util_default = {
    format: format2,
    promisify,
    inspect,
    deprecate,
    debuglog,
    callbackify,
    inherits,
    isArray,
    isDeepStrictEqual,
    _extend,
    types,
    parseArgs
  };


  var node_v8_exports = {};
  __export(node_v8_exports, {
    default: () => node_v8_default,
    deserialize: () => deserialize,
    serialize: () => serialize,
    setFlagsFromString: () => setFlagsFromString
  });
  var serialize = (value) => JSON.stringify(value) ?? "null";
  var deserialize = (value) => JSON.parse(value);
  var setFlagsFromString = (_flags) => void 0;
  var node_v8_default = { serialize, deserialize, setFlagsFromString };


  var node_vm_exports = {};
  __export(node_vm_exports, {
    Script: () => Script3,
    compileFunction: () => compileFunction,
    createContext: () => createContext,
    default: () => node_vm_default,
    runInThisContext: () => runInThisContext
  });
  var unavailable8 = (name) => () => {
    throw new Error(`${name} is not available in the embedded extension host`);
  };
  var runInThisContext = unavailable8("runInThisContext");
  var createContext = unavailable8("createContext");
  var compileFunction = unavailable8("compileFunction");
  var Script3 = class {
    constructor(_code) {
    }
    runInThisContext() {
      throw new Error("node:vm is not available in the embedded extension host");
    }
  };
  var node_vm_default = { runInThisContext, createContext, compileFunction, Script: Script3 };


  var node_worker_threads_exports = {};
  __export(node_worker_threads_exports, {
    Worker: () => Worker,
    default: () => node_worker_threads_default,
    isMainThread: () => isMainThread,
    parentPort: () => parentPort,
    threadId: () => threadId,
    workerData: () => workerData
  });
  var unavailable9 = (name) => () => {
    throw new Error(`${name} is not available in the embedded extension host`);
  };
  var Worker = unavailable9("Worker");
  var parentPort = null;
  var workerData = null;
  var isMainThread = true;
  var threadId = 0;
  var node_worker_threads_default = { Worker, parentPort, workerData, isMainThread, threadId };


  var node_zlib_exports = {};
  __export(node_zlib_exports, {
    crc32: () => crc32,
    default: () => node_zlib_default,
    deflateRawSync: () => deflateRawSync,
    gunzipSync: () => gunzipSync,
    gzipSync: () => gzipSync,
    inflateRawSync: () => inflateRawSync
  });
  var unavailable10 = (name) => () => {
    throw new Error(`${name} is not available in the embedded extension host`);
  };
  var crc32 = unavailable10("crc32");
  var deflateRawSync = unavailable10("deflateRawSync");
  var inflateRawSync = unavailable10("inflateRawSync");
  var gzipSync = unavailable10("gzipSync");
  var gunzipSync = unavailable10("gunzipSync");
  var node_zlib_default = { crc32, deflateRawSync, inflateRawSync, gzipSync, gunzipSync };


  var globals2 = globalThis;
  var hostCall = (op, args) => {
    const response = JSON.parse(globals2.__piHostCall(op, JSON.stringify(args ?? {})));
    if (!response.ok) throw new Error(response.error ?? "the host refused the call");
    return response.value;
  };
  var nodeModules = () => globals2.__piNodeModules;
  var themeTokens;
  var themeTokenMap = () => {
    if (!themeTokens) {
      try {
        const value = hostCall("theme.get", {});
        themeTokens = {
          fg: value?.fg ?? {},
          bg: value?.bg ?? {},
          colors: value?.colors ?? {},
          colorEnabled: value?.colorEnabled ?? false,
          name: value?.name,
          sourcePath: value?.sourcePath,
          appearance: value?.appearance ?? "dark",
          colorMode: value?.colorMode ?? "truecolor"
        };
      } catch {
        themeTokens = {
          fg: {},
          bg: {},
          colors: {},
          colorEnabled: false,
          appearance: "dark",
          colorMode: "truecolor"
        };
      }
    }
    return themeTokens;
  };
  var styleText = (text, fgAnsi, bgAnsi, options) => {
    let prefix = "";
    let suffix = "";
    if (fgAnsi) {
      prefix += fgAnsi;
      suffix = "\x1B[39m";
    }
    if (bgAnsi) {
      prefix += bgAnsi;
      suffix = `\x1B[49m${suffix}`;
    }
    if (options.bold) prefix += "\x1B[1m";
    if (options.dim) prefix += "\x1B[2m";
    if (options.bold || options.dim) suffix = `\x1B[22m${suffix}`;
    if (options.italic) {
      prefix += "\x1B[3m";
      suffix = `\x1B[23m${suffix}`;
    }
    if (options.underline) {
      prefix += "\x1B[4m";
      suffix = `\x1B[24m${suffix}`;
    }
    if (options.inverse) {
      prefix += "\x1B[7m";
      suffix = `\x1B[27m${suffix}`;
    }
    if (options.strikethrough) {
      prefix += "\x1B[9m";
      suffix = `\x1B[29m${suffix}`;
    }
    return `${prefix}${text}${suffix}`;
  };
  var chalkStyle = (enabled, code, closing, text) => enabled ? `\x1B[${code}m${text}\x1B[${closing}m` : text;
  var theme = {
    fg: (name, text) => {
      const prefix = themeTokenMap().fg[name];
      return prefix ? `${prefix}${text}\x1B[39m` : text;
    },
    bg: (name, text) => {
      const prefix = themeTokenMap().bg[name];
      return prefix ? `${prefix}${text}\x1B[49m` : text;
    },
    bgStart: (name) => themeTokenMap().bg[name] ?? "",
    style: (text, options) => {
      const tokens = themeTokenMap();
      const fgAnsi = options.fg === void 0 ? void 0 : tokens.fg[options.fg];
      const bgAnsi = options.bg === void 0 ? void 0 : tokens.bg[options.bg];
      return styleText(text, fgAnsi, bgAnsi, options);
    },
    bold: (text) => chalkStyle(themeTokenMap().colorEnabled, "1", "22", text),
    italic: (text) => chalkStyle(themeTokenMap().colorEnabled, "3", "23", text),
    underline: (text) => chalkStyle(themeTokenMap().colorEnabled, "4", "24", text),
    inverse: (text) => chalkStyle(themeTokenMap().colorEnabled, "7", "27", text),
    strikethrough: (text) => chalkStyle(themeTokenMap().colorEnabled, "9", "29", text),
    get colors() {
      return themeTokenMap().colors;
    },
    get name() {
      return themeTokenMap().name;
    },
    get sourcePath() {
      return themeTokenMap().sourcePath;
    },
    get appearance() {
      return themeTokenMap().appearance;
    },
    getFgAnsi: (name) => themeTokenMap().fg[name] ?? "",
    getBgAnsi: (name) => themeTokenMap().bg[name] ?? "",
    getColorMode: () => themeTokenMap().colorMode,
    getThinkingBorderColor: (level) => (text) => theme.fg(`thinking${level}`, text),
    getBashModeBorderColor: () => (text) => theme.fg("bashMode", text)
  };
  var hostModeValue;
  var hostMode = () => {
    if (!hostModeValue) {
      try {
        hostModeValue = hostCall("context.mode", {});
      } catch {
        hostModeValue = "print";
      }
    }
    return hostModeValue;
  };
  var tuiStub = () => new Proxy(
    {},
    {
      get: (_target, property) => {
        if (typeof property === "symbol" || property === "then") return void 0;
        if (property === "requestRender") return () => void 0;
        if (property === "theme") return theme;
        return () => void 0;
      }
    }
  );
  var footerDataStub = () => ({
    getGitBranch: () => {
      try {
        return hostCall("footer.getGitBranch", {});
      } catch {
        return void 0;
      }
    },
    getExtensionStatuses: () => {
      try {
        return hostCall("footer.getExtensionStatuses", {});
      } catch {
        return {};
      }
    },
    getAvailableProviderCount: () => 0,
    onBranchChange: () => () => void 0
  });
  var componentRegistry = /* @__PURE__ */ new Map();
  var componentCounter = 0;
  var toolCallCounter = 0;
  var registerTerminalInput = (state2, handler) => {
    state2.terminalInputHandlers.push(handler);
    return () => {
      const index3 = state2.terminalInputHandlers.indexOf(handler);
      if (index3 >= 0) state2.terminalInputHandlers.splice(index3, 1);
    };
  };
  var createModelRegistry = () => ({
    refresh: () => hostCall("models.refresh", {}),
    getError: () => hostCall("models.getError", {}),
    getAll: () => hostCall("models.list", {}),
    getAvailable: () => hostCall("models.listAvailable", {}),
    find: (provider, modelId) => hostCall("models.find", { provider, modelId }),
    hasConfiguredAuth: (model) => hostCall("models.hasConfiguredAuth", { model }),
    getProviderAuthStatus: (provider) => hostCall("models.getProviderAuthStatus", { provider }),
    getProvider: (provider) => hostCall("models.getProvider", { provider }),
    getProviderDisplayName: (provider) => hostCall("models.getProviderDisplayName", { provider }),
    isUsingOAuth: (model) => hostCall("models.isUsingOAuth", { model }),
    registerProvider: (provider, config) => {
      hostCall("provider.register", { provider, config });
    },
    unregisterProvider: (name) => {
      hostCall("provider.unregister", { name });
    },
    registerVirtualModel: (definition) => {
      hostCall("model.registerVirtual", { model: definition });
    },
    unregisterVirtualModel: (provider, id) => {
      hostCall("model.unregisterVirtual", { provider, id });
    },
    getRegisteredProviderIds: () => hostCall("models.getRegisteredProviderIds", {})
  });
  var registerComponent = (factory) => {
    const id = `component-${++componentCounter}`;
    componentRegistry.set(id, { factory });
    return id;
  };
  var renderComponent = (id, width) => {
    const entry = componentRegistry.get(id);
    if (!entry) return [];
    if (!entry.component) {
      const produced = entry.factory(tuiStub(), theme, footerDataStub());
      if (!produced || typeof produced.render !== "function") return [];
      entry.component = produced;
    }
    const lines = entry.component.render(width);
    return Array.isArray(lines) ? lines.map((line) => String(line)) : [];
  };
  var VIRTUAL_MODULES = {
    typebox: build_exports,
    "typebox/compile": compile_exports,
    "typebox/value": value_exports2,
    "@sinclair/typebox": build_exports,
    "@sinclair/typebox/compile": compile_exports,
    "@sinclair/typebox/value": value_exports2,
    "@earendil-works/pi-agent-core": pi_agent_core_exports,
    "@mariozechner/pi-agent-core": pi_agent_core_exports,
    "@earendil-works/pi-tui": pi_tui_exports,
    "@mariozechner/pi-tui": pi_tui_exports,
    "@earendil-works/pi-ai": pi_ai_exports,
    "@earendil-works/pi-ai/compat": pi_ai_exports,
    "@earendil-works/pi-ai/oauth": pi_ai_exports,
    "@earendil-works/pi-ai/providers/all": pi_ai_exports,
    "@mariozechner/pi-ai": pi_ai_exports,
    "@mariozechner/pi-ai/compat": pi_ai_exports,
    "@mariozechner/pi-ai/oauth": pi_ai_exports,
    "@mariozechner/pi-ai/providers/all": pi_ai_exports,
    "@earendil-works/pi-coding-agent": types_exports,
    "@mariozechner/pi-coding-agent": types_exports
  };
  var moduleCache = /* @__PURE__ */ new Map();
  var NODE_BUILTINS = {
    "node:assert": node_assert_exports,
    assert: node_assert_exports,
    "node:async_hooks": node_async_hooks_exports,
    async_hooks: node_async_hooks_exports,
    "node:buffer": node_buffer_exports,
    buffer: node_buffer_exports,
    "node:child_process": node_child_process_exports,
    child_process: node_child_process_exports,
    "node:cluster": node_cluster_exports,
    cluster: node_cluster_exports,
    "node:console": node_console_exports,
    console: node_console_exports,
    "node:crypto": node_crypto_exports,
    crypto: node_crypto_exports,
    "node:dgram": node_dgram_exports,
    dgram: node_dgram_exports,
    "node:diagnostics_channel": node_diagnostics_channel_exports,
    diagnostics_channel: node_diagnostics_channel_exports,
    "node:dns": node_dns_exports,
    dns: node_dns_exports,
    "node:events": node_events_exports,
    events: node_events_exports,
    "node:fs": shim_fs,
    fs: shim_fs,
    "node:fs/promises": shim_fs_promises,
    "node:http": node_http_exports,
    http: node_http_exports,
    "node:http2": node_http2_exports,
    http2: node_http2_exports,
    "node:inspector": node_inspector_exports,
    inspector: node_inspector_exports,
    "node:module": node_module_exports,
    module: node_module_exports,
    "node:net": node_net_exports,
    net: node_net_exports,
    "node:os": node_os_exports,
    os: node_os_exports,
    "node:path": node_path_exports,
    path: node_path_exports,
    "node:perf_hooks": node_perf_hooks_exports,
    perf_hooks: node_perf_hooks_exports,
    "node:process": node_process_exports,
    process: node_process_exports,
    "node:punycode": node_punycode_exports,
    punycode: node_punycode_exports,
    "node:querystring": node_querystring_exports,
    querystring: node_querystring_exports,
    "node:readline": node_readline_exports,
    readline: node_readline_exports,
    "node:readline/promises": node_readline_promises_exports,
    "node:sqlite": node_sqlite_exports,
    sqlite: node_sqlite_exports,
    "node:stream": node_stream_exports,
    stream: node_stream_exports,
    "node:stream/promises": node_stream_promises_exports,
    "node:stream/web": node_stream_web_exports,
    "node:string_decoder": node_string_decoder_exports,
    string_decoder: node_string_decoder_exports,
    "node:sys": node_sys_exports,
    sys: node_sys_exports,
    "node:timers": node_timers_exports,
    timers: node_timers_exports,
    "node:timers/promises": timers_promises_exports,
    "node:tls": node_tls_exports,
    tls: node_tls_exports,
    "node:trace_events": node_trace_events_exports,
    trace_events: node_trace_events_exports,
    "node:tty": node_tty_exports,
    tty: node_tty_exports,
    "node:url": node_url_exports,
    url: node_url_exports,
    "node:util": node_util_exports,
    "node:v8": node_v8_exports,
    v8: node_v8_exports,
    "node:vm": node_vm_exports,
    vm: node_vm_exports,
    "node:worker_threads": node_worker_threads_exports,
    worker_threads: node_worker_threads_exports,
    "node:zlib": node_zlib_exports,
    zlib: node_zlib_exports,
    "constants": constants
  };
  var resolveModule = (specifier, referrer) => {
    if (Object.prototype.hasOwnProperty.call(VIRTUAL_MODULES, specifier)) {
      return VIRTUAL_MODULES[specifier];
    }
    if (Object.prototype.hasOwnProperty.call(NODE_BUILTINS, specifier)) {
      return NODE_BUILTINS[specifier];
    }
    const builtins = globals2.__piNodeModules;
    if (Object.prototype.hasOwnProperty.call(builtins, specifier)) {
      return builtins[specifier];
    }
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      const paths = nodeModules()["node:path"];
      const absolute = specifier.startsWith("/") ? specifier : paths.resolve(paths.dirname(referrer), specifier);
      const loaded = hostCall("module.load", { path: absolute });
      return loadModule(loaded.path, loaded.code);
    }
    if (specifier.startsWith("@earendil-works/") || specifier.startsWith("@mariozechner/")) {
      return {};
    }
    throw new Error(`cannot resolve "${specifier}" from "${referrer}"`);
  };
  var loadModule = (path2, code) => {
    const cached = moduleCache.get(path2);
    if (cached) return cached.exports;
    const module = { exports: {} };
    moduleCache.set(path2, module);
    const paths = nodeModules()["node:path"];
    const factory = new Function(
      "exports",
      "require",
      "module",
      "__filename",
      "__dirname",
      "__piExports",
      "__piImportMeta",
      code
    );
    factory(
      module.exports,
      (specifier) => resolveModule(specifier, path2),
      module,
      path2,
      paths.dirname(path2),
      module.exports,
      {
        url: `file://${path2}`,
        filename: path2,
        dirname: paths.dirname(path2)
      }
    );
    return module.exports;
  };
  var createEventBus = () => {
    const handlers = /* @__PURE__ */ new Map();
    return {
      emit: (channel2, data) => {
        for (const handler of handlers.get(channel2) ?? []) {
          try {
            void handler(data, void 0);
          } catch (error2) {
            console.error(`Event handler error (${channel2}):`, error2);
          }
        }
      },
      on: (channel2, handler) => {
        const list = handlers.get(channel2) ?? [];
        list.push(handler);
        handlers.set(channel2, list);
        return () => {
          const current = handlers.get(channel2) ?? [];
          const index3 = current.indexOf(handler);
          if (index3 >= 0) current.splice(index3, 1);
        };
      }
    };
  };
  var askDialog = async (kind, args) => {
    const opened = hostCall("ui.select", { ...args, kind });
    const requestId = opened?.requestId;
    if (!requestId) return void 0;
    for (; ; ) {
      await new Promise((resolve3) => setTimeout(resolve3, 20));
      const answer = hostCall("ui.pollDialog", { requestId, kind });
      if (answer?.answered) return answer.value;
    }
  };
  var createContext2 = (state2) => ({
    ui: {
      theme,
      notify: (message, type2) => {
        hostCall("ui.notify", { message, type: type2 ?? "info" });
      },
      setStatus: (key, text) => {
        hostCall("ui.setStatus", { key, text: text ?? "" });
      },
      setWidget: (key, content, options) => {
        if (content === void 0) {
          hostCall("ui.setWidget", { key });
          return;
        }
        const placement = options?.placement ?? "aboveEditor";
        if (Array.isArray(content)) {
          hostCall("ui.setWidget", { key, lines: content, placement });
          return;
        }
        hostCall("ui.setWidget", { key, component: registerComponent(content), placement });
      },
      setHeader: (factory) => {
        if (!factory) {
          hostCall("ui.setHeader", {});
          return;
        }
        hostCall("ui.setHeader", { component: registerComponent(factory) });
      },
      setFooter: (factory) => {
        if (!factory) {
          hostCall("ui.setFooter", {});
          return;
        }
        hostCall("ui.setFooter", { component: registerComponent(factory) });
      },
      setTitle: (title) => {
        hostCall("ui.setTitle", { title });
      },
      setWorkingMessage: (message) => {
        hostCall("ui.setWorkingMessage", { message: message ?? "" });
      },
      setWorkingVisible: (visible) => {
        hostCall("ui.setWorkingVisible", { visible });
      },
      setHiddenThinkingLabel: (label) => {
        hostCall("ui.setHiddenThinkingLabel", { label });
      },
      setEditorText: (text) => {
        hostCall("ui.setEditorText", { text });
      },
      getEditorText: () => hostCall("ui.getEditorText", {}),
      pasteToEditor: (text) => {
        hostCall("ui.pasteToEditor", { text });
      },
      select: (title, options) => askDialog("selector", { title, options }),
      confirm: (title, message) => askDialog("confirm", { title, message }),
      input: (title, placeholder) => askDialog("input", { title, placeholder }),
      editor: (title, prefill) => askDialog("editor", { title, prefill }),
      custom: async (factory) => {
        hostCall("ui.custom", { component: registerComponent(factory) });
      },
      setWorkingIndicator: (options) => {
        hostCall("ui.setWorkingIndicator", { options: options ?? null });
      },
      setEditorComponent: (factory) => {
        hostCall("ui.setEditorComponent", {
          component: factory ? registerComponent(factory) : null
        });
      },
      getEditorComponent: () => {
        const answer = hostCall("ui.getEditorComponent", {});
        return answer ?? void 0;
      },
      getAllThemes: () => hostCall("ui.getAllThemes", {}),
      getTheme: (name) => hostCall("ui.getTheme", { name }),
      setTheme: (theme2) => hostCall("ui.setTheme", { theme: theme2 }),
      getToolsExpanded: () => hostCall("ui.getToolsExpanded", {}),
      setToolsExpanded: (expanded) => {
        hostCall("ui.setToolsExpanded", { expanded });
      },
      onTerminalInput: (handler) => registerTerminalInput(state2, handler),
      addAutocompleteProvider: (factory) => {
        state2.autocompleteProviders.push(factory);
      }
    },
    get mode() {
      return hostMode();
    },
    get hasUI() {
      return hostMode() === "tui";
    },
    get cwd() {
      return hostCall("process.cwd", {});
    },
    sessionManager: {
      getCwd: () => hostCall("process.cwd", {}),
      getSessionDir: () => hostCall("session.getDir", {}),
      getSessionId: () => hostCall("session.getId", {}),
      getSessionFile: () => hostCall("session.getFile", {}),
      getLeafId: () => hostCall("session.getLeafId", {}),
      getLeafEntry: () => hostCall("session.getLeafEntry", {}),
      getEntry: (id) => hostCall("session.getEntry", { id }),
      getLabel: (id) => hostCall("session.getLabel", { id }),
      getBranch: () => hostCall("session.getBranch", {}),
      buildContextEntries: () => hostCall("session.buildContextEntries", {}),
      buildSessionProjection: () => hostCall("session.buildSessionProjection", {}),
      getHeader: () => hostCall("session.getHeader", {}),
      getEntries: () => hostCall("session.getEntries", {}),
      getTree: () => hostCall("session.getTree", {}),
      getSessionName: () => {
        const answer = hostCall("session.getSessionName", {});
        return answer ?? void 0;
      }
    },
    modelRegistry: createModelRegistry(),
    get model() {
      return hostCall("model.get", {});
    },
    scopedModels: [],
    get thinkingLevel() {
      const answer = hostCall("model.getThinkingLevel", {});
      return answer?.level ?? "off";
    },
    isIdle: () => hostCall("agent.isIdle", {}),
    isProjectTrusted: () => hostCall("agent.isProjectTrusted", {}),
    signal: void 0,
    abort: () => hostCall("agent.abort", {}),
    hasPendingMessages: () => hostCall("agent.hasPendingMessages", {}),
    shutdown: () => hostCall("session.shutdown", {}),
    getContextUsage: () => hostCall("agent.getContextUsage", {}),
    compact: (options) => hostCall("agent.compact", { options }),
    getSystemPrompt: () => {
      const answer = hostCall("agent.getSystemPrompt", {});
      return answer?.prompt ?? "";
    },
    extensionPath: state2.path
  });
  var createToolContext = (state2) => ({
    ...createContext2(state2),
    tools: {
      registered: hostCall("tools.getAll", {}),
      getExposure: (name) => hostCall("tools.getExposure", { name }),
      getNamespace: (name) => hostCall("tools.getNamespace", { name }),
      getPromptGuidelines: (name) => hostCall("tools.getPromptGuidelines", { name })
    },
    executeTool: (name, args, options) => hostCall("tools.execute", { name, args, options: options ?? null })
  });
  var eventBus = createEventBus();
  var createApi = (state2) => {
    const events = eventBus;
    return {
      on: (event, handler) => {
        const handlers = state2.handlers.get(event) ?? [];
        handlers.push(handler);
        state2.handlers.set(event, handlers);
        return () => {
          const current = state2.handlers.get(event) ?? [];
          const index3 = current.indexOf(handler);
          if (index3 >= 0) current.splice(index3, 1);
        };
      },
      registerTool: (tool) => {
        state2.tools.set(tool.name, tool);
      },
      registerCommand: (name, options) => {
        state2.commands.set(name, options);
      },
      registerShortcut: (shortcut, options) => {
        state2.shortcuts.set(shortcut, options);
      },
      registerFlag: (name, options) => {
        state2.flags.set(name, options);
      },
      getFlag: (name) => state2.flags.get(name)?.default,
      registerMessageRenderer: (customType, renderer) => {
        state2.messageRenderers.set(customType, renderer);
      },
      registerMarkdownTransformer: (transformer) => {
        state2.markdownTransformers.push(transformer);
      },
      registerEntryRenderer: (customType, renderer) => {
        state2.entryRenderers.set(customType, renderer);
      },
      registerToolRenderer: (resolver) => {
        state2.toolRenderers.push(resolver);
      },
      sendMessage: (message, options) => {
        hostCall("session.sendMessage", { message, options });
      },
      sendUserMessage: (content, options) => {
        hostCall("session.sendUserMessage", { content, options });
      },
      appendEntry: (customType, data) => {
        hostCall("session.appendEntry", { customType, data });
      },
      setSessionName: (name) => {
        hostCall("session.setSessionName", { name });
      },
      getSessionName: () => {
        const answer = hostCall("session.getSessionName", {});
        return answer ?? void 0;
      },
      setLabel: (entryId, label) => {
        hostCall("session.setLabel", { entryId, label });
      },
      exec: (command, args, options) => hostCall("session.exec", { command, args, options }),
      getActiveTools: () => {
        const answer = hostCall("tools.getActive", {});
        return answer?.tools ?? [];
      },
      getAllTools: () => hostCall("tools.getAll", {}),
      getSettings: () => hostCall("settings.get", {}),
      setActiveTools: (toolNames) => {
        hostCall("tools.setActive", { toolNames });
      },
      getCommands: () => hostCall("commands.get", {}),
      setModel: (model) => hostCall("model.set", { model }),
      getThinkingLevel: () => {
        const answer = hostCall("model.getThinkingLevel", {});
        return answer?.level ?? "off";
      },
      setThinkingLevel: (level) => {
        hostCall("model.setThinkingLevel", { level });
      },
      registerProvider: (provider, config) => {
        hostCall("provider.register", { provider, config });
      },
      unregisterProvider: (name) => {
        hostCall("provider.unregister", { name });
      },
      registerMcpServer: (name, config) => {
        hostCall("mcp.register", { name, config, extensionPath: state2.path });
      },
      unregisterMcpServer: (name) => {
        hostCall("mcp.unregister", { name });
      },
      getMcpServers: () => hostCall("mcp.list", {}),
      registerVirtualModel: (model) => {
        hostCall("model.registerVirtual", { model });
      },
      unregisterVirtualModel: (provider, id) => {
        hostCall("model.unregisterVirtual", { provider, id });
      },
      events
    };
  };
  var extensions = [];
  var listTools = () => extensions.flatMap(
    (state2) => [...state2.tools.values()].map((tool) => ({
      name: tool.name,
      label: tool.label ?? tool.name,
      description: tool.description ?? "",
      parameters: tool.parameters ?? null
    }))
  );
  var loadExtension = async (path2, code) => {
    const exports = loadModule(path2, code);
    const factory = exports.default ?? exports;
    if (typeof factory !== "function") {
      throw new Error(`${path2} does not export an extension factory`);
    }
    const state2 = {
      path: path2,
      handlers: /* @__PURE__ */ new Map(),
      tools: /* @__PURE__ */ new Map(),
      commands: /* @__PURE__ */ new Map(),
      shortcuts: /* @__PURE__ */ new Map(),
      flags: /* @__PURE__ */ new Map(),
      messageRenderers: /* @__PURE__ */ new Map(),
      entryRenderers: /* @__PURE__ */ new Map(),
      markdownTransformers: [],
      toolRenderers: [],
      autocompleteProviders: [],
      terminalInputHandlers: []
    };
    await factory(createApi(state2));
    extensions.push(state2);
    return { path: path2, tools: listTools() };
  };
  var callTool = async (name, args) => {
    let found;
    for (const state2 of extensions) {
      const tool = state2.tools.get(name);
      if (tool) {
        found = { state: state2, tool };
        break;
      }
    }
    if (!found) throw new Error(`unknown tool: ${name}`);
    const result = await found.tool.execute(
      `tool-call-${++toolCallCounter}`,
      args,
      void 0,
      void 0,
      createToolContext(found.state)
    );
    return result ?? null;
  };
  var listCommands = () => extensions.flatMap(
    (state2) => [...state2.commands.entries()].map(([name, options]) => {
      const description = options && typeof options === "object" && "description" in options ? String(options.description ?? "") : "";
      return { name, description, path: state2.path };
    })
  );
  var listHandlers = () => extensions.flatMap(
    (state2) => [...state2.handlers.keys()].map((event) => ({ event, path: state2.path }))
  );
  var dispatch = async (event, payload) => {
    let result;
    for (const state2 of extensions) {
      const context = createContext2(state2);
      for (const handler of state2.handlers.get(event) ?? []) {
        const value = await handler(payload, context);
        if (value !== void 0 && result === void 0) result = value;
      }
    }
    return result === void 0 ? null : result;
  };
  var emitInput = async (text, images, source) => {
    let currentText = text;
    let currentImages = images;
    for (const state2 of extensions) {
      const context = createContext2(state2);
      for (const handler of state2.handlers.get("input") ?? []) {
        const result = await handler(
          { type: "input", text: currentText, images: currentImages, source },
          context
        );
        if (result?.action === "handled") return { action: "handled" };
        if (result?.action === "transform" && typeof result.text === "string") {
          currentText = result.text;
          currentImages = result.images ?? currentImages;
        }
      }
    }
    return currentText === text ? { action: "continue" } : { action: "transform", text: currentText };
  };
  var runCommand = async (name, args) => {
    for (const state2 of extensions) {
      const options = state2.commands.get(name);
      if (!options || typeof options !== "object" || !("handler" in options)) continue;
      const handler = options.handler;
      if (typeof handler !== "function") continue;
      const result = await handler(args, createContext2(state2));
      return result === void 0 ? null : result;
    }
    throw new Error(`unknown command: ${name}`);
  };
  globalThis.__piExtensionHost = {
    loadExtension,
    callTool,
    listTools,
    listCommands,
    listHandlers,
    runCommand,
    renderComponent,
    emitInput,
    dispatch
  };
})();
