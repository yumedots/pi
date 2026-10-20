//! Private execution state. Public model snapshots never carry request headers
//! or credentials; requests recover their configuration by model identity here.
use super::*;

#[derive(Clone, Default)]
pub(super) enum RequestAuth {
    #[default]
    None,
    ApiKey(String),
    Headers(BTreeMap<String, String>),
}

pub(super) struct ExecutionBinding {
    provider_id: String,
    models: Vec<Model>,
    descriptors: Vec<Model>,
    auth: RequestAuth,
    requires_auth: bool,
    model_selected: bool,
}

impl std::fmt::Debug for ExecutionBinding {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExecutionBinding")
            .field("provider", &self.provider_id)
            .field("models", &self.models.len())
            .field("auth", &"[redacted]")
            .finish()
    }
}

pub(super) fn descriptor(model: &Model) -> Model {
    let mut model = model.clone();
    model.headers = None;
    model
}

impl ExecutionBinding {
    /// Bind one provider runtime.
    ///
    /// `models` is the provider's whole catalog: every model stays bound so a
    /// request for an unauthenticated model is answered with the login
    /// guidance instead of "model is not registered". `provider_has_auth`
    /// decides which models may be published: with a provider credential every
    /// model is loadable, without one only the models carrying their own
    /// auth headers are.
    pub fn new(
        provider_id: &str,
        models: Vec<Model>,
        auth: RequestAuth,
        provider_has_auth: bool,
        model_selected: bool,
    ) -> Self {
        let descriptors = models
            .iter()
            .filter(|model| provider_has_auth || model_has_header_auth(model))
            .map(descriptor)
            .collect();
        Self {
            provider_id: provider_id.into(),
            models,
            descriptors,
            auth,
            requires_auth: !provider_has_auth,
            model_selected,
        }
    }

    pub fn models(&self) -> &[Model] {
        &self.descriptors
    }

    /// The bound model, with its own request headers.
    pub fn bind(&self, requested: &Model) -> Option<Model> {
        self.resolve_model(requested)
    }

    /// The model a request is served with.
    ///
    /// An exact id match wins. A model id the catalogue does not know (the
    /// resolver's "using custom model id" fallback) is served by the
    /// provider's own entry: same provider, same protocol, same endpoint and
    /// credential, with the requested id.
    fn resolve_model(&self, requested: &Model) -> Option<Model> {
        self.models
            .iter()
            .find(|model| {
                requested.provider == self.provider_id
                    && model.provider == requested.provider
                    && model.api == requested.api
                    && model.id.eq_ignore_ascii_case(&requested.id)
            })
            .cloned()
            .or_else(|| {
                self.models
                    .iter()
                    .find(|model| {
                        requested.provider == self.provider_id
                            && model.provider == requested.provider
                            && model.api == requested.api
                    })
                    .map(|model| {
                        let mut model = model.clone();
                        model.id = requested.id.clone();
                        model.name = requested.name.clone();
                        model
                    })
            })
    }

    /// Whether a request without credentials must be refused.
    pub fn requires_auth(&self) -> bool {
        self.requires_auth
    }

    /// The guidance shown when a request cannot authenticate. Mirrors the TS
    /// `formatNoModelSelectedMessage` / `formatNoApiKeyFoundMessage` split: a
    /// session without a selected model says so, a selected model without a
    /// credential names its provider.
    pub fn missing_credential_message(&self, provider: &str) -> String {
        if self.model_selected {
            crate::auth_guidance::no_api_key_found_message(provider)
        } else {
            crate::auth_guidance::no_model_selected_message()
        }
    }

    pub fn prepare(
        &self,
        requested: &Model,
        options: &SimpleStreamOptions,
    ) -> Option<(Model, SimpleStreamOptions)> {
        // The caller may select a published model, but cannot substitute an
        // endpoint or headers to redirect an already-bound credential.
        let model = self.resolve_model(requested)?;
        let mut options = options.clone();
        if options.api_key.is_none() {
            match &self.auth {
                RequestAuth::None => {}
                RequestAuth::ApiKey(key) => options.api_key = Some(key.clone()),
                RequestAuth::Headers(headers) => {
                    let mut merged = headers.clone();
                    for (name, value) in options.headers.take().unwrap_or_default() {
                        merged.retain(|known, _| !known.eq_ignore_ascii_case(&name));
                        merged.insert(name, value);
                    }
                    options.headers = Some(merged);
                }
            }
        }
        Some((model, options))
    }

    #[cfg(test)]
    pub fn request_model(&self, requested: &Model) -> Model {
        let (mut model, options) = self
            .prepare(requested, &SimpleStreamOptions::default())
            .unwrap();
        if let Some(headers) = &options.headers {
            merge_auth_headers(&mut model, headers);
        }
        if model.api != rpi_ai::Api::AnthropicMessages {
            if let Some(key) = options.api_key {
                merge_auth_headers(
                    &mut model,
                    &BTreeMap::from([("authorization".into(), format!("Bearer {key}"))]),
                );
            }
        }
        model
    }
}
