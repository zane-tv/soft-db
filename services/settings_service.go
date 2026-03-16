package services

import (
	"encoding/json"
	"soft-db/internal/store"
)

// AppSettings holds all user-configurable settings
type AppSettings struct {
	// General
	Language         string `json:"language"`
	AutoConnect      bool   `json:"autoConnect"`
	ConfirmDangerous bool   `json:"confirmDangerous"`
	MaxHistory       int    `json:"maxHistory"`

	// Appearance
	Theme      string `json:"theme"`
	FontSize   int    `json:"fontSize"`
	RowDensity string `json:"rowDensity"`

	// Editor
	TabSize       int  `json:"tabSize"`
	WordWrap      bool `json:"wordWrap"`
	LineNumbers   bool `json:"lineNumbers"`
	AutoUppercase bool `json:"autoUppercase"`

	// Query Execution
	QueryTimeout     int  `json:"queryTimeout"`
	DefaultLimit     int  `json:"defaultLimit"`
	ConfirmMutations bool `json:"confirmMutations"`
	AutoLimit        bool `json:"autoLimit"`

	// Connection
	ConnectionTimeout int `json:"connectionTimeout"`

	// Data & Export
	NullDisplay  string `json:"nullDisplay"`
	DateFormat   string `json:"dateFormat"`
	ExportFormat string `json:"exportFormat"`
	CsvDelimiter string `json:"csvDelimiter"`
}

// DefaultSettings returns the default settings
func DefaultSettings() AppSettings {
	return AppSettings{
		// General
		Language:         "en",
		AutoConnect:      false,
		ConfirmDangerous: true,
		MaxHistory:       500,

		// Appearance
		Theme:      "dark",
		FontSize:   13,
		RowDensity: "normal",

		// Editor
		TabSize:       2,
		WordWrap:      false,
		LineNumbers:   true,
		AutoUppercase: false,

		// Query Execution
		QueryTimeout:     30,
		DefaultLimit:     100,
		ConfirmMutations: false,
		AutoLimit:        false,

		// Connection
		ConnectionTimeout: 15,

		// Data & Export
		NullDisplay:  "badge",
		DateFormat:   "iso",
		ExportFormat: "csv",
		CsvDelimiter: ",",
	}
}

// SettingsService manages app settings (bound to Wails frontend)
type SettingsService struct {
	store  *store.Store
	cached *AppSettings // in-memory cache
}

// NewSettingsService creates the service
func NewSettingsService(s *store.Store) *SettingsService {
	return &SettingsService{store: s}
}

// GetSettings returns current settings (defaults merged with user overrides)
func (s *SettingsService) GetSettings() (AppSettings, error) {
	if s.cached != nil {
		return *s.cached, nil
	}

	defaults := DefaultSettings()

	raw, err := s.store.LoadSettings()
	if err != nil {
		return defaults, nil
	}

	if raw == "{}" {
		s.cached = &defaults
		return defaults, nil
	}

	// Start with defaults, then overlay user values
	result := defaults
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return defaults, nil
	}

	s.cached = &result
	return result, nil
}

// UpdateSettings saves settings and invalidates cache
func (s *SettingsService) UpdateSettings(settings AppSettings) error {
	data, err := json.Marshal(settings)
	if err != nil {
		return err
	}

	if err := s.store.SaveSettings(string(data)); err != nil {
		return err
	}

	s.cached = &settings
	return nil
}

// GetQueryTimeout returns the current query timeout in seconds (for internal use)
func (s *SettingsService) GetQueryTimeout() int {
	settings, _ := s.GetSettings()
	if settings.QueryTimeout <= 0 {
		return 30
	}
	return settings.QueryTimeout
}

// GetConnectionTimeout returns the current connection timeout in seconds (for internal use)
func (s *SettingsService) GetConnectionTimeout() int {
	settings, _ := s.GetSettings()
	if settings.ConnectionTimeout <= 0 {
		return 15
	}
	return settings.ConnectionTimeout
}

// GetMaxHistory returns the max history entries per connection (for internal use)
func (s *SettingsService) GetMaxHistory() int {
	settings, _ := s.GetSettings()
	if settings.MaxHistory <= 0 {
		return 500
	}
	return settings.MaxHistory
}
