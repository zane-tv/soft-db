package services

import (
	"testing"
)

func TestDefaultSettings_Values(t *testing.T) {
	t.Parallel()
	d := DefaultSettings()

	if d.Language != "en" {
		t.Errorf("Language = %q, want %q", d.Language, "en")
	}
	if d.QueryTimeout != 30 {
		t.Errorf("QueryTimeout = %d, want 30", d.QueryTimeout)
	}
	if d.MaxHistory != 500 {
		t.Errorf("MaxHistory = %d, want 500", d.MaxHistory)
	}
	if d.ConnectionTimeout != 15 {
		t.Errorf("ConnectionTimeout = %d, want 15", d.ConnectionTimeout)
	}
	if d.Theme != "dark" {
		t.Errorf("Theme = %q, want %q", d.Theme, "dark")
	}
	if d.FontSize != 13 {
		t.Errorf("FontSize = %d, want 13", d.FontSize)
	}
	if d.TabSize != 2 {
		t.Errorf("TabSize = %d, want 2", d.TabSize)
	}
	if !d.LineNumbers {
		t.Error("LineNumbers = false, want true")
	}
}

func TestSettingsService_GetSettings_ReturnsDefaults(t *testing.T) {
	t.Parallel()
	ss := NewSettingsService(newTestStore(t))

	settings, err := ss.GetSettings()
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if settings.QueryTimeout != 30 {
		t.Errorf("QueryTimeout = %d, want 30", settings.QueryTimeout)
	}
	if settings.Language != "en" {
		t.Errorf("Language = %q, want %q", settings.Language, "en")
	}
}

func TestSettingsService_UpdateAndGet_RoundTrip(t *testing.T) {
	t.Parallel()
	ss := NewSettingsService(newTestStore(t))

	updated := DefaultSettings()
	updated.QueryTimeout = 60
	updated.Theme = "light"
	updated.Language = "fr"
	updated.MaxHistory = 1000

	if err := ss.UpdateSettings(updated); err != nil {
		t.Fatalf("UpdateSettings: %v", err)
	}

	got, err := ss.GetSettings()
	if err != nil {
		t.Fatalf("GetSettings after update: %v", err)
	}
	if got.QueryTimeout != 60 {
		t.Errorf("QueryTimeout = %d, want 60", got.QueryTimeout)
	}
	if got.Theme != "light" {
		t.Errorf("Theme = %q, want %q", got.Theme, "light")
	}
	if got.Language != "fr" {
		t.Errorf("Language = %q, want %q", got.Language, "fr")
	}
	if got.MaxHistory != 1000 {
		t.Errorf("MaxHistory = %d, want 1000", got.MaxHistory)
	}
}

func TestSettingsService_GetSettings_UsesCache(t *testing.T) {
	t.Parallel()
	ss := NewSettingsService(newTestStore(t))

	s1, _ := ss.GetSettings()
	s2, _ := ss.GetSettings()

	if s1.QueryTimeout != s2.QueryTimeout {
		t.Errorf("cached settings differ: %v vs %v", s1.QueryTimeout, s2.QueryTimeout)
	}
}

func TestSettingsService_GetQueryTimeout(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		timeout int
		want    int
	}{
		{"default 30", 30, 30},
		{"custom 60", 60, 60},
		{"zero uses default", 0, 30},
		{"negative uses default", -5, 30},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ss := NewSettingsService(newTestStore(t))
			s := DefaultSettings()
			s.QueryTimeout = tt.timeout
			if err := ss.UpdateSettings(s); err != nil {
				t.Fatalf("UpdateSettings: %v", err)
			}

			got := ss.GetQueryTimeout()
			if got != tt.want {
				t.Errorf("GetQueryTimeout() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestSettingsService_GetConnectionTimeout(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		timeout int
		want    int
	}{
		{"default 15", 15, 15},
		{"custom 30", 30, 30},
		{"zero uses default", 0, 15},
		{"negative uses default", -1, 15},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ss := NewSettingsService(newTestStore(t))
			s := DefaultSettings()
			s.ConnectionTimeout = tt.timeout
			if err := ss.UpdateSettings(s); err != nil {
				t.Fatalf("UpdateSettings: %v", err)
			}

			got := ss.GetConnectionTimeout()
			if got != tt.want {
				t.Errorf("GetConnectionTimeout() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestSettingsService_GetMaxHistory(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		max  int
		want int
	}{
		{"default 500", 500, 500},
		{"custom 1000", 1000, 1000},
		{"zero uses default", 0, 500},
		{"negative uses default", -10, 500},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ss := NewSettingsService(newTestStore(t))
			s := DefaultSettings()
			s.MaxHistory = tt.max
			if err := ss.UpdateSettings(s); err != nil {
				t.Fatalf("UpdateSettings: %v", err)
			}

			got := ss.GetMaxHistory()
			if got != tt.want {
				t.Errorf("GetMaxHistory() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestSettingsService_UpdateSettings_InvalidatesCache(t *testing.T) {
	t.Parallel()
	ss := NewSettingsService(newTestStore(t))

	s1 := DefaultSettings()
	s1.QueryTimeout = 10
	if err := ss.UpdateSettings(s1); err != nil {
		t.Fatalf("UpdateSettings s1: %v", err)
	}
	got1, _ := ss.GetSettings()

	s2 := DefaultSettings()
	s2.QueryTimeout = 99
	if err := ss.UpdateSettings(s2); err != nil {
		t.Fatalf("UpdateSettings s2: %v", err)
	}
	got2, _ := ss.GetSettings()

	if got1.QueryTimeout == got2.QueryTimeout {
		t.Errorf("expected cache invalidation; both reads returned %d", got1.QueryTimeout)
	}
}
