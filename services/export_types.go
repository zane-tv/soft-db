package services

type ExportMode string

const (
	ExportModeWorkspace ExportMode = "workspace"
	ExportModeSchema    ExportMode = "schema"
	ExportModeData      ExportMode = "data"
)

type DataExportFormat string

const (
	FormatCSV          DataExportFormat = "csv"
	FormatJSON         DataExportFormat = "json"
	FormatSQLInsert    DataExportFormat = "sql"
	FormatExtendedJSON DataExportFormat = "extended_json"
)

type WorkspaceExport struct {
	Version     int                `json:"version"`
	ExportedAt  string             `json:"exportedAt"`
	AppName     string             `json:"appName"`
	Connections []ConnectionExport `json:"connections"`
	Settings    *AppSettings       `json:"settings,omitempty"`
	Snippets    []SnippetExport    `json:"snippets,omitempty"`
}

type ConnectionExport struct {
	Name      string `json:"name"`
	Type      string `json:"type"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Database  string `json:"database"`
	Username  string `json:"username"`
	Password  string `json:"password,omitempty"`
	FilePath  string `json:"filePath,omitempty"`
	URI       string `json:"uri,omitempty"`
	SSLMode   string `json:"sslMode,omitempty"`
	Encrypted bool   `json:"encrypted"`
}

type SnippetExport struct {
	Title    string   `json:"title"`
	Content  string   `json:"content"`
	Language string   `json:"language"`
	Tags     []string `json:"tags,omitempty"`
}

type ExportProgress struct {
	Phase      string  `json:"phase"`
	Current    int64   `json:"current"`
	Total      int64   `json:"total"`
	Percentage float64 `json:"percentage"`
	Message    string  `json:"message"`
}

type ConflictStrategy string

const (
	ConflictSkip    ConflictStrategy = "skip"
	ConflictReplace ConflictStrategy = "replace"
	ConflictRename  ConflictStrategy = "rename"
)

type DatabaseExportRequest struct {
	ConnectionID  string           `json:"connectionId"`
	DatabaseName  string           `json:"databaseName,omitempty"`
	Tables        []string         `json:"tables,omitempty"`
	IncludeSchema bool             `json:"includeSchema"`
	IncludeData   bool             `json:"includeData"`
	DataFormat    DataExportFormat `json:"dataFormat"`
	FilePath      string           `json:"filePath"`
}

type DatabaseImportRequest struct {
	ConnectionID   string           `json:"connectionId"`
	DatabaseName   string           `json:"databaseName,omitempty"`
	FilePath       string           `json:"filePath"`
	SchemaStrategy ConflictStrategy `json:"schemaStrategy"`
	DataStrategy   ConflictStrategy `json:"dataStrategy"`
}

type WorkspaceImportResult struct {
	ConnectionsImported int  `json:"connectionsImported"`
	ConnectionsSkipped  int  `json:"connectionsSkipped"`
	SnippetsImported    int  `json:"snippetsImported"`
	SettingsImported    bool `json:"settingsImported"`
}
