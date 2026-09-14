import { getProviderModelInfo } from '@jupyternaut/agent';
import type {
  IProviderConfig,
  IProviderParameters,
  IProviderRegistry
} from '@jupyternaut/agent';
import type { TranslationBundle } from '@jupyterlab/translation';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Switch,
  TextField,
  Typography
} from '@mui/material';
import React from 'react';

/**
 * Default parameter values for provider configuration
 */
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TURNS = 25;

interface IProviderConfigDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (config: Omit<IProviderConfig, 'id'>) => void;
  initialConfig?: IProviderConfig;
  mode: 'add' | 'edit';
  providerRegistry: IProviderRegistry;
  handleSecretField: (
    input: HTMLInputElement,
    provider: string,
    fieldName: string
  ) => Promise<void>;
  trans: TranslationBundle;
}

export const ProviderConfigDialog: React.FC<IProviderConfigDialogProps> = ({
  open,
  onClose,
  onSave,
  initialConfig,
  mode,
  providerRegistry,
  handleSecretField,
  trans
}) => {
  const [name, setName] = React.useState(initialConfig?.name || '');
  const [provider, setProvider] = React.useState(
    initialConfig?.provider || 'anthropic'
  );
  const [model, setModel] = React.useState(initialConfig?.model || '');
  const [apiKey, setApiKey] = React.useState(initialConfig?.apiKey || '');
  const [baseURL, setBaseURL] = React.useState(initialConfig?.baseURL || '');
  const [showApiKey, setShowApiKey] = React.useState(false);
  const [parameters, setParameters] = React.useState<IProviderParameters>(
    initialConfig?.parameters || {}
  );

  const [expandedAdvanced, setExpandedAdvanced] = React.useState(false);
  const selectedProviderInfo = React.useMemo(
    () => providerRegistry.getProviderInfo(provider),
    [providerRegistry, provider]
  );
  const selectedModelInfo = React.useMemo(
    () => getProviderModelInfo(selectedProviderInfo, model),
    [selectedProviderInfo, model]
  );

  // Get provider options from registry
  const providerOptions = React.useMemo(() => {
    const providers = providerRegistry.providers;
    return Object.keys(providers).map(id => {
      const info = providers[id];
      return {
        value: id,
        label: info.name,
        models: info.defaultModels,
        apiKeyRequirement: info.apiKeyRequirement,
        supportsBaseURL: info.supportsBaseURL,
        description: info.description,
        baseUrls: info.baseUrls
      };
    });
  }, [providerRegistry]);

  const selectedProvider = providerOptions.find(p => p.value === provider);

  React.useEffect(() => {
    if (open) {
      // Reset form when dialog opens
      const initialProvider = initialConfig?.provider || 'anthropic';
      const initialProviderInfo =
        providerRegistry.getProviderInfo(initialProvider);
      setName(initialConfig?.name || '');
      setProvider(initialProvider);
      setModel(
        initialConfig?.model || initialProviderInfo?.defaultModels[0] || ''
      );
      setApiKey(initialConfig?.apiKey || '');
      setBaseURL(initialConfig?.baseURL || '');
      setParameters(initialConfig?.parameters || {});
      setShowApiKey(false);
      setExpandedAdvanced(false);
    } else {
      // Reset expanded state when dialog closes
      setExpandedAdvanced(false);
    }
  }, [open, initialConfig, providerRegistry]);

  const handleRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      if (open && node) {
        handleSecretField(node, provider, 'apiKey');
      }
    },
    [provider, handleSecretField, open]
  );

  const handleProviderChange = React.useCallback(
    (newProvider: IProviderConfig['provider']) => {
      const newProviderInfo = providerRegistry.getProviderInfo(newProvider);
      setProvider(newProvider);
      setModel(newProviderInfo?.defaultModels[0] || '');
    },
    [providerRegistry]
  );

  const handleSave = () => {
    if (!name.trim() || !provider || !model) {
      return;
    }

    // Only include parameters if at least one is set
    const hasParameters = Object.keys(parameters).some(
      key => parameters[key as keyof IProviderParameters] !== undefined
    );

    const config: Omit<IProviderConfig, 'id'> = {
      name: name.trim(),
      provider: provider as IProviderConfig['provider'],
      model,
      ...(apiKey && { apiKey }),
      ...(baseURL && { baseURL }),
      ...(hasParameters && { parameters })
    };

    onSave(config);
    onClose();
  };

  const isValid =
    name.trim() &&
    provider &&
    model &&
    (selectedProvider?.apiKeyRequirement !== 'required' || apiKey);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {mode === 'add'
          ? trans.__('Add New Provider')
          : trans.__('Edit Provider')}
      </DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          <TextField
            fullWidth
            label={trans.__('Provider Name')}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={trans.__('e.g., My Anthropic Config, Work Provider')}
            helperText={trans.__(
              'A friendly name to identify this provider configuration'
            )}
            required
          />

          <FormControl fullWidth required>
            <InputLabel>{trans.__('Provider Type')}</InputLabel>
            <Select
              value={provider}
              label={trans.__('Provider Type')}
              onChange={e =>
                handleProviderChange(
                  e.target.value as IProviderConfig['provider']
                )
              }
            >
              {providerOptions.map(option => (
                <MenuItem key={option.value} value={option.value}>
                  <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {option.label}
                      {option.apiKeyRequirement === 'required' && (
                        <Chip
                          size="small"
                          label={trans.__('API Key')}
                          color="default"
                          variant="outlined"
                        />
                      )}
                    </Box>
                    {option.description && (
                      <Typography variant="caption" color="text.secondary">
                        {option.description}
                      </Typography>
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Autocomplete
            freeSolo
            fullWidth
            options={selectedProvider?.models ?? []}
            value={model}
            onChange={(_, value) => {
              setModel(typeof value === 'string' ? value : '');
            }}
            inputValue={model}
            onInputChange={(_, value) => {
              setModel(value);
            }}
            renderInput={params => (
              <TextField
                {...params}
                fullWidth
                label={trans.__('Model')}
                placeholder={trans.__('Select or type a model ID')}
                required
                helperText={trans.__(
                  'Choose from the list or enter a custom model ID'
                )}
              />
            )}
            clearOnBlur={false}
          />

          {selectedProvider &&
            selectedProvider?.apiKeyRequirement !== 'none' && (
              <TextField
                fullWidth
                inputRef={handleRef}
                label={
                  selectedProvider?.apiKeyRequirement === 'required'
                    ? trans.__('API Key')
                    : trans.__('API Key (Optional)')
                }
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={trans.__('Enter your API key...')}
                required={selectedProvider?.apiKeyRequirement === 'required'}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowApiKey(!showApiKey)}
                        edge="end"
                      >
                        {showApiKey ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  )
                }}
              />
            )}

          {selectedProvider?.supportsBaseURL && (
            <Autocomplete
              freeSolo
              fullWidth
              options={(selectedProvider.baseUrls ?? []).map(
                option => option.url
              )}
              value={baseURL || ''}
              onChange={(_, value) => {
                if (value && typeof value === 'string') {
                  setBaseURL(value);
                }
              }}
              inputValue={baseURL || ''}
              renderOption={(props, option) => {
                const urlOption = (selectedProvider.baseUrls ?? []).find(
                  u => u.url === option
                );
                return (
                  <Box component="li" {...props} key={option}>
                    <Box>
                      <Typography variant="body2">{option}</Typography>
                      {urlOption?.description && (
                        <Typography variant="caption" color="text.secondary">
                          {urlOption.description}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              }}
              renderInput={params => (
                <TextField
                  {...params}
                  fullWidth
                  label={trans.__('Base URL')}
                  placeholder="https://api.example.com/v1"
                  onChange={e => setBaseURL(e.target.value)}
                />
              )}
              clearOnBlur={false}
            />
          )}

          {/* Advanced Settings Section */}
          <Accordion
            expanded={expandedAdvanced}
            onChange={(_, isExpanded) => setExpandedAdvanced(isExpanded)}
            sx={{
              mt: 2,
              bgcolor: 'transparent',
              boxShadow: 'none',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1
            }}
          >
            <AccordionSummary expandIcon={<ExpandMore />}>
              <Typography variant="subtitle1" fontWeight="medium">
                {trans.__('Advanced Settings')}
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ bgcolor: 'transparent' }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Box>
                  <Typography gutterBottom>
                    {trans.__(
                      'Temperature: %1',
                      parameters.temperature ?? trans.__('Default')
                    )}
                  </Typography>
                  <Slider
                    value={parameters.temperature ?? DEFAULT_TEMPERATURE}
                    onChange={(_, value) =>
                      setParameters({
                        ...parameters,
                        temperature: value as number
                      })
                    }
                    min={0}
                    max={2}
                    step={0.1}
                    valueLabelDisplay="auto"
                  />
                  <Typography variant="caption" color="text.secondary">
                    {trans.__(
                      'Temperature for the model (lower values are more deterministic)'
                    )}
                  </Typography>
                </Box>

                <TextField
                  fullWidth
                  label={trans.__('Max Tokens (Optional)')}
                  type="number"
                  value={parameters.maxOutputTokens ?? ''}
                  onChange={e =>
                    setParameters({
                      ...parameters,
                      maxOutputTokens: e.target.value
                        ? Number(e.target.value)
                        : undefined
                    })
                  }
                  placeholder={trans.__('Leave empty for provider default')}
                  helperText={trans.__('Maximum length of AI responses')}
                  slotProps={{ htmlInput: { min: 1 } }}
                />

                <TextField
                  fullWidth
                  label={trans.__('Max Turns (Optional)')}
                  type="number"
                  value={parameters.maxTurns ?? ''}
                  onChange={e =>
                    setParameters({
                      ...parameters,
                      maxTurns: e.target.value
                        ? Number(e.target.value)
                        : undefined
                    })
                  }
                  placeholder={trans.__('Default: %1', DEFAULT_MAX_TURNS)}
                  helperText={trans.__(
                    'Maximum number of tool execution turns'
                  )}
                  slotProps={{ htmlInput: { min: 1, max: 100 } }}
                />

                <TextField
                  fullWidth
                  label={trans.__('Context Window (Optional)')}
                  type="number"
                  value={parameters.contextWindow ?? ''}
                  onChange={e =>
                    setParameters({
                      ...parameters,
                      contextWindow: e.target.value
                        ? Number(e.target.value)
                        : undefined
                    })
                  }
                  placeholder={
                    selectedModelInfo?.contextWindow !== undefined
                      ? trans.__(
                          'Default: %1',
                          selectedModelInfo.contextWindow.toLocaleString()
                        )
                      : trans.__('e.g., 128000')
                  }
                  helperText={
                    selectedModelInfo?.contextWindow !== undefined &&
                    parameters.contextWindow === undefined
                      ? trans.__(
                          'Using provider metadata default of %1 tokens for this model unless you override it here.',
                          selectedModelInfo.contextWindow.toLocaleString()
                        )
                      : trans.__(
                          'Model context window size in tokens (used for context usage estimation)'
                        )
                  }
                  slotProps={{ htmlInput: { min: 1 } }}
                />

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 2, mb: 1 }}
                >
                  {trans.__('Completion Options')}
                </Typography>

                <FormControlLabel
                  control={
                    <Switch
                      checked={parameters.supportsFillInMiddle ?? false}
                      onChange={e =>
                        setParameters({
                          ...parameters,
                          supportsFillInMiddle: e.target.checked
                        })
                      }
                    />
                  }
                  label={trans.__('Fill-in-the-middle support')}
                />

                <FormControlLabel
                  control={
                    <Switch
                      checked={parameters.useFilterText ?? false}
                      onChange={e =>
                        setParameters({
                          ...parameters,
                          useFilterText: e.target.checked
                        })
                      }
                    />
                  }
                  label={trans.__('Use filter text')}
                />
              </Box>
            </AccordionDetails>
          </Accordion>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{trans.__('Cancel')}</Button>
        <Button onClick={handleSave} variant="contained" disabled={!isValid}>
          {mode === 'add' ? trans.__('Add Provider') : trans.__('Save Changes')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
