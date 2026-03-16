// ─── i18n: English + Vietnamese ───

export type Language = 'en' | 'vi'

const translations = {
  en: {
    // ─── Settings Modal ───
    'settings.title': 'Settings',
    'settings.general': 'General',
    'settings.appearance': 'Appearance',
    'settings.editor': 'Editor',
    'settings.execution': 'Execution',
    'settings.connection': 'Connection',
    'settings.data': 'Data & Export',
    'settings.about': 'About',
    'settings.done': 'Done',

    // General
    'settings.language': 'Language',
    'settings.language.desc': 'Choose display language',
    'settings.autoConnect': 'Auto Connect',
    'settings.autoConnect.desc': 'Reconnect to last used connections on startup',

    // Appearance
    'settings.theme': 'Theme',
    'settings.theme.desc': 'Choose your preferred color scheme',
    'settings.theme.dark': 'Dark',
    'settings.theme.light': 'Light',
    'settings.theme.nord': 'Nord',
    'settings.theme.dracula': 'Dracula',
    'settings.fontSize': 'Font Size',
    'settings.fontSize.desc': 'Editor font size in pixels',
    'settings.rowDensity': 'Row Density',
    'settings.rowDensity.desc': 'Spacing between table rows',
    'settings.rowDensity.compact': 'Compact',
    'settings.rowDensity.comfortable': 'Comfortable',
    'settings.rowDensity.spacious': 'Spacious',

    // Editor
    'settings.tabSize': 'Tab Size',
    'settings.tabSize.desc': 'Number of spaces per tab',
    'settings.wordWrap': 'Word Wrap',
    'settings.wordWrap.desc': 'Wrap long lines in the editor',
    'settings.lineNumbers': 'Line Numbers',
    'settings.lineNumbers.desc': 'Show line numbers in the editor',
    'settings.autoUppercase': 'Auto Uppercase',
    'settings.autoUppercase.desc': 'Automatically capitalize SQL keywords',

    // Execution
    'settings.queryTimeout': 'Query Timeout',
    'settings.queryTimeout.desc': 'Maximum seconds to wait for query results',
    'settings.confirmDangerous': 'Confirm Dangerous',
    'settings.confirmDangerous.desc': 'Confirm before DROP, TRUNCATE, ALTER',
    'settings.confirmMutations': 'Confirm Mutations',
    'settings.confirmMutations.desc': 'Confirm before INSERT, UPDATE, DELETE',
    'settings.autoLimit': 'Auto Limit',
    'settings.autoLimit.desc': 'Auto-append LIMIT to SELECT queries',
    'settings.defaultLimit': 'Default Limit',
    'settings.defaultLimit.desc': 'Number of rows to fetch by default',

    // Connection
    'settings.connectionTimeout': 'Connection Timeout',
    'settings.connectionTimeout.desc': 'Max seconds to wait when connecting',
    'settings.maxHistory': 'Max History',
    'settings.maxHistory.desc': 'Maximum query history entries per connection',

    // Data & Export
    'settings.nullDisplay': 'NULL Display',
    'settings.nullDisplay.desc': 'How NULL values are displayed',
    'settings.nullDisplay.italic': 'Italic',
    'settings.nullDisplay.dash': 'Dash',
    'settings.nullDisplay.badge': 'Badge',
    'settings.dateFormat': 'Date Format',
    'settings.dateFormat.desc': 'How dates are formatted in results',
    'settings.exportFormat': 'Export Format',
    'settings.exportFormat.desc': 'Default format for data export',
    'settings.csvDelimiter': 'CSV Delimiter',
    'settings.csvDelimiter.desc': 'Column separator for CSV exports',

    // Sidebar
    'sidebar.tables': 'Tables',
    'sidebar.views': 'Views',
    'sidebar.functions': 'Functions',
    'sidebar.search': 'Search tables...',
    'sidebar.noTables': 'No tables found',
    'sidebar.noColumns': 'No columns',
    'sidebar.loading': 'Loading...',
    'sidebar.settings': 'Settings',

    // Navigation
    'nav.home': 'Home',

    // Tab bar
    'tab.new': 'New Tab',

    // Footer
    'footer.rows': 'rows',
    'footer.affected': 'affected',
    'footer.error': 'Error',
    'footer.ready': 'Ready',

    // Results
    'results.noData': 'Run a query to see results here',
    'results.execute': 'Execute a query to see results',

    // Confirm modal
    'confirm.dangerousTitle': 'Dangerous Operation',
    'confirm.dangerousMessage': 'This query contains a destructive operation that could permanently modify or remove data.',
    'confirm.execute': 'Execute',
    'confirm.cancel': 'Cancel',

    // History
    'history.title': 'Activity Log',
    'history.filterPlaceholder': 'Filter by query or status...',
    'history.tab.history': 'History',
    'history.tab.saved': 'Saved',
    'history.noHistory': 'No query history yet',
    'history.noSnippets': 'No saved snippets',
    'history.createSnippet': 'Create new snippet',

    // Connection Hub
    'hub.connections': 'Connections',
    'hub.noConnections': 'No connections yet',
    'hub.searchPlaceholder': 'Search connections...',
    'hub.deleteConnection': 'Delete Connection',
    'hub.newConnection': 'New Connection',
    'hub.connectNewDb': 'Connect New Database',
    'hub.addConnection': 'Add Connection',
    'hub.addFirstConnection': 'Add your first database connection to get started.',
    'hub.loading': 'Loading...',
    'hub.checking': 'Checking',
    'hub.connections.suffix': 'connection',
    'hub.connections.suffixPlural': 'connections',
    'hub.configured': 'configured.',
    'hub.noSaved': 'No saved connections yet.',
    'hub.deleteMessage': 'Are you sure you want to delete',
    'hub.deleteWarning': 'This will also remove all query history for this connection.',
    'hub.delete': 'Delete',
    'hub.cancel': 'Cancel',
    'hub.connect': 'Connect',
    'hub.disconnect': 'Disconnect',
    'hub.edit': 'Edit',
    'hub.idle': 'Idle',
    'hub.lastUsed': 'last used',
    'hub.database': 'database',
    'hub.databases': 'databases',

    // Connection Picker
    'connection.open': 'Open Connection',
    'connection.searchPlaceholder': 'Search connections...',
    'connection.new': 'New Connection',
    'connection.edit': 'Edit Connection',
    'connection.noResults': 'No connections found',
    'connection.open.badge': 'Open',
    'connection.status.connected': 'Connected',
    'connection.status.offline': 'Offline',
    'connection.status.idle': 'Idle',

    // Connection Modal
    'modal.newConnection': 'New Connection',
    'modal.editConnection': 'Edit Connection',
    'modal.configureDesc': 'Configure your database connection details.',
    'modal.connectionName': 'Connection Name',
    'modal.databaseType': 'Database Type',
    'modal.filePath': 'Database File Path',
    'modal.browse': 'Browse',
    'modal.formFields': 'Form Fields',
    'modal.connectionUrl': 'Connection URL',
    'modal.urlHint': 'Paste your MongoDB connection string from Atlas or your server',
    'modal.host': 'Host',
    'modal.port': 'Port',
    'modal.database': 'Database',
    'modal.optional': 'optional',
    'modal.dbHint': 'Leave empty to browse all databases',
    'modal.username': 'Username',
    'modal.password': 'Password',
    'modal.testing': 'Testing connection...',
    'modal.success': 'Connection successful!',
    'modal.failed': 'Connection failed:',
    'modal.testConnection': 'Test Connection',
    'modal.cancel': 'Cancel',
    'modal.update': 'Update',
    'modal.save': 'Save',

    // Editor
    'editor.sqlPreview': 'SQL to Execute',
    'editor.readOnly': 'Read-only',
    'editor.search': 'Search...',

    // Pending Changes
    'pending.change': 'pending change',
    'pending.changes': 'pending changes',
    'pending.reviewSQL': 'Review SQL',
    'pending.discard': 'Discard',
    'pending.apply': 'Apply',
    'pending.saving': 'Saving...',
    'pending.close': 'Close',
    'pending.confirmExecute': 'Confirm & Execute',
    'pending.statement': 'statement',
    'pending.statements': 'statements',

    // AI Panel
    'ai.title': 'AI Assistant',
    'ai.welcome': 'Database AI Assistant',
    'ai.placeholder': 'Ask about your database...',

    // Structure Designer
    'structure.generatedDDL': 'Generated DDL',
    'structure.order': 'Order',
    'structure.columnName': 'Column Name',
    'structure.type': 'Type',
    'structure.constraints': 'Constraints',
    'structure.actions': 'Actions',
    'structure.new': 'New',
    'structure.edit': 'Edit',

    // Mongo Schema Editor
    'mongo.commandPreview': 'MongoDB Command Preview',
    'mongo.fieldName': 'Field Name',
    'mongo.bsonType': 'BSON Type',
    'mongo.required': 'Required',
    'mongo.description': 'Description',

    // About
    'about.version': 'Version',
    'about.description': 'Modern database management tool. Connect, explore, and manage your databases with a beautiful cross-platform desktop app.',
    'about.databases': 'Supported Databases',
    'about.shortcuts': 'Keyboard Shortcuts',
    'about.license': 'MIT License — Made with ❤️ by Zane',
    'about.shortcut.execute': 'Execute Query',
    'about.shortcut.newTab': 'New Tab',
    'about.shortcut.closeTab': 'Close Tab',
    'about.shortcut.save': 'Save Snippet',
    'about.shortcut.settings': 'Open Settings',
    'about.shortcut.fullscreen': 'Toggle Full View',
  },

  vi: {
    // ─── Settings Modal ───
    'settings.title': 'Cài đặt',
    'settings.general': 'Chung',
    'settings.appearance': 'Giao diện',
    'settings.editor': 'Trình soạn',
    'settings.execution': 'Thực thi',
    'settings.connection': 'Kết nối',
    'settings.data': 'Dữ liệu & Xuất',
    'settings.about': 'Thông tin',
    'settings.done': 'Xong',

    // General
    'settings.language': 'Ngôn ngữ',
    'settings.language.desc': 'Chọn ngôn ngữ hiển thị',
    'settings.autoConnect': 'Tự động kết nối',
    'settings.autoConnect.desc': 'Kết nối lại các kết nối gần nhất khi khởi động',

    // Appearance
    'settings.theme': 'Giao diện',
    'settings.theme.desc': 'Chọn bảng màu yêu thích',
    'settings.theme.dark': 'Tối',
    'settings.theme.light': 'Sáng',
    'settings.theme.nord': 'Nord',
    'settings.theme.dracula': 'Dracula',
    'settings.fontSize': 'Cỡ chữ',
    'settings.fontSize.desc': 'Cỡ chữ trình soạn (pixel)',
    'settings.rowDensity': 'Mật độ hàng',
    'settings.rowDensity.desc': 'Khoảng cách giữa các hàng',
    'settings.rowDensity.compact': 'Thu gọn',
    'settings.rowDensity.comfortable': 'Thoải mái',
    'settings.rowDensity.spacious': 'Rộng rãi',

    // Editor
    'settings.tabSize': 'Kích thước tab',
    'settings.tabSize.desc': 'Số khoảng trắng mỗi tab',
    'settings.wordWrap': 'Tự động xuống dòng',
    'settings.wordWrap.desc': 'Tự động ngắt dòng dài trong trình soạn',
    'settings.lineNumbers': 'Số dòng',
    'settings.lineNumbers.desc': 'Hiển thị số dòng trong trình soạn',
    'settings.autoUppercase': 'Tự động viết hoa',
    'settings.autoUppercase.desc': 'Tự động viết hoa từ khóa SQL',

    // Execution
    'settings.queryTimeout': 'Thời gian chờ truy vấn',
    'settings.queryTimeout.desc': 'Số giây tối đa chờ kết quả truy vấn',
    'settings.confirmDangerous': 'Xác nhận thao tác nguy hiểm',
    'settings.confirmDangerous.desc': 'Xác nhận trước khi DROP, TRUNCATE, ALTER',
    'settings.confirmMutations': 'Xác nhận thay đổi dữ liệu',
    'settings.confirmMutations.desc': 'Xác nhận trước khi INSERT, UPDATE, DELETE',
    'settings.autoLimit': 'Tự động giới hạn',
    'settings.autoLimit.desc': 'Tự động thêm LIMIT vào truy vấn SELECT',
    'settings.defaultLimit': 'Giới hạn mặc định',
    'settings.defaultLimit.desc': 'Số hàng lấy mặc định',

    // Connection
    'settings.connectionTimeout': 'Thời gian chờ kết nối',
    'settings.connectionTimeout.desc': 'Số giây tối đa khi kết nối',
    'settings.maxHistory': 'Lịch sử tối đa',
    'settings.maxHistory.desc': 'Số lượng lịch sử truy vấn tối đa mỗi kết nối',

    // Data & Export
    'settings.nullDisplay': 'Hiển thị NULL',
    'settings.nullDisplay.desc': 'Cách hiển thị giá trị NULL',
    'settings.nullDisplay.italic': 'Nghiêng',
    'settings.nullDisplay.dash': 'Gạch ngang',
    'settings.nullDisplay.badge': 'Nhãn',
    'settings.dateFormat': 'Định dạng ngày',
    'settings.dateFormat.desc': 'Cách hiển thị ngày trong kết quả',
    'settings.exportFormat': 'Định dạng xuất',
    'settings.exportFormat.desc': 'Định dạng mặc định khi xuất dữ liệu',
    'settings.csvDelimiter': 'Phân cách CSV',
    'settings.csvDelimiter.desc': 'Ký tự phân cách cột cho file CSV',

    // Sidebar
    'sidebar.tables': 'Bảng',
    'sidebar.views': 'View',
    'sidebar.functions': 'Hàm',
    'sidebar.search': 'Tìm bảng...',
    'sidebar.noTables': 'Không tìm thấy bảng',
    'sidebar.noColumns': 'Không có cột',
    'sidebar.loading': 'Đang tải...',
    'sidebar.settings': 'Cài đặt',

    // Navigation
    'nav.home': 'Trang chủ',

    // Tab bar
    'tab.new': 'Tab mới',

    // Footer
    'footer.rows': 'dòng',
    'footer.affected': 'bị ảnh hưởng',
    'footer.error': 'Lỗi',
    'footer.ready': 'Sẵn sàng',

    // Results
    'results.noData': 'Chạy truy vấn để xem kết quả',
    'results.execute': 'Thực thi truy vấn để xem kết quả',

    // Confirm modal
    'confirm.dangerousTitle': 'Thao tác nguy hiểm',
    'confirm.dangerousMessage': 'Truy vấn này chứa thao tác có thể thay đổi hoặc xóa dữ liệu vĩnh viễn.',
    'confirm.execute': 'Thực thi',
    'confirm.cancel': 'Hủy',

    // History
    'history.title': 'Lịch sử hoạt động',
    'history.filterPlaceholder': 'Lọc theo truy vấn hoặc trạng thái...',
    'history.tab.history': 'Lịch sử',
    'history.tab.saved': 'Đã lưu',
    'history.noHistory': 'Chưa có lịch sử truy vấn',
    'history.noSnippets': 'Chưa có snippet nào',
    'history.createSnippet': 'Tạo snippet mới',

    // Connection Hub
    'hub.connections': 'Kết nối',
    'hub.noConnections': 'Chưa có kết nối nào',
    'hub.searchPlaceholder': 'Tìm kết nối...',
    'hub.deleteConnection': 'Xoá kết nối',
    'hub.newConnection': 'Kết nối mới',
    'hub.connectNewDb': 'Kết nối cơ sở dữ liệu mới',
    'hub.addConnection': 'Thêm kết nối',
    'hub.addFirstConnection': 'Thêm kết nối cơ sở dữ liệu đầu tiên để bắt đầu.',
    'hub.loading': 'Đang tải...',
    'hub.checking': 'Đang kiểm tra',
    'hub.connections.suffix': 'kết nối',
    'hub.connections.suffixPlural': 'kết nối',
    'hub.configured': 'đã cấu hình.',
    'hub.noSaved': 'Chưa có kết nối nào được lưu.',
    'hub.deleteMessage': 'Bạn có chắc chắn muốn xoá',
    'hub.deleteWarning': 'Thao tác này cũng sẽ xoá toàn bộ lịch sử truy vấn của kết nối này.',
    'hub.delete': 'Xoá',
    'hub.cancel': 'Huỷ',
    'hub.connect': 'Kết nối',
    'hub.disconnect': 'Ngắt kết nối',
    'hub.edit': 'Sửa',
    'hub.idle': 'Chờ',
    'hub.lastUsed': 'dùng lần cuối',
    'hub.database': 'cơ sở dữ liệu',
    'hub.databases': 'cơ sở dữ liệu',

    // Connection Picker
    'connection.open': 'Mở kết nối',
    'connection.searchPlaceholder': 'Tìm kết nối...',
    'connection.new': 'Kết nối mới',
    'connection.edit': 'Sửa kết nối',
    'connection.noResults': 'Không tìm thấy kết nối',
    'connection.open.badge': 'Đang mở',
    'connection.status.connected': 'Đã kết nối',
    'connection.status.offline': 'Ngoại tuyến',
    'connection.status.idle': 'Chờ',

    // Connection Modal
    'modal.newConnection': 'Kết nối mới',
    'modal.editConnection': 'Sửa kết nối',
    'modal.configureDesc': 'Cấu hình chi tiết kết nối cơ sở dữ liệu.',
    'modal.connectionName': 'Tên kết nối',
    'modal.databaseType': 'Loại cơ sở dữ liệu',
    'modal.filePath': 'Đường dẫn file cơ sở dữ liệu',
    'modal.browse': 'Duyệt',
    'modal.formFields': 'Trường nhập',
    'modal.connectionUrl': 'URL kết nối',
    'modal.urlHint': 'Dán chuỗi kết nối MongoDB từ Atlas hoặc máy chủ của bạn',
    'modal.host': 'Máy chủ',
    'modal.port': 'Cổng',
    'modal.database': 'Cơ sở dữ liệu',
    'modal.optional': 'tuỳ chọn',
    'modal.dbHint': 'Để trống để duyệt tất cả cơ sở dữ liệu',
    'modal.username': 'Tên đăng nhập',
    'modal.password': 'Mật khẩu',
    'modal.testing': 'Đang thử kết nối...',
    'modal.success': 'Kết nối thành công!',
    'modal.failed': 'Kết nối thất bại:',
    'modal.testConnection': 'Thử kết nối',
    'modal.cancel': 'Huỷ',
    'modal.update': 'Cập nhật',
    'modal.save': 'Lưu',

    // Editor
    'editor.sqlPreview': 'SQL sẽ thực thi',
    'editor.readOnly': 'Chỉ đọc',
    'editor.search': 'Tìm kiếm...',

    // Pending Changes
    'pending.change': 'thay đổi chờ xử lý',
    'pending.changes': 'thay đổi chờ xử lý',
    'pending.reviewSQL': 'Xem SQL',
    'pending.discard': 'Huỷ bỏ',
    'pending.apply': 'Áp dụng',
    'pending.saving': 'Đang lưu...',
    'pending.close': 'Đóng',
    'pending.confirmExecute': 'Xác nhận & Thực thi',
    'pending.statement': 'câu lệnh',
    'pending.statements': 'câu lệnh',

    // AI Panel
    'ai.title': 'Trợ lý AI',
    'ai.welcome': 'Trợ lý AI cơ sở dữ liệu',
    'ai.placeholder': 'Hỏi về cơ sở dữ liệu...',

    // Structure Designer
    'structure.generatedDDL': 'DDL đã tạo',
    'structure.order': 'Thứ tự',
    'structure.columnName': 'Tên cột',
    'structure.type': 'Kiểu',
    'structure.constraints': 'Ràng buộc',
    'structure.actions': 'Thao tác',
    'structure.new': 'Mới',
    'structure.edit': 'Sửa',

    // Mongo Schema Editor
    'mongo.commandPreview': 'Xem trước lệnh MongoDB',
    'mongo.fieldName': 'Tên trường',
    'mongo.bsonType': 'Kiểu BSON',
    'mongo.required': 'Bắt buộc',
    'mongo.description': 'Mô tả',

    // About
    'about.version': 'Phiên bản',
    'about.description': 'Công cụ quản lý cơ sở dữ liệu hiện đại. Kết nối, khám phá và quản lý cơ sở dữ liệu với ứng dụng desktop đa nền tảng.',
    'about.databases': 'Cơ sở dữ liệu hỗ trợ',
    'about.shortcuts': 'Phím tắt',
    'about.license': 'Giấy phép MIT — Tạo bởi Zane với ❤️',
    'about.shortcut.execute': 'Thực thi truy vấn',
    'about.shortcut.newTab': 'Tab mới',
    'about.shortcut.closeTab': 'Đóng tab',
    'about.shortcut.save': 'Lưu snippet',
    'about.shortcut.settings': 'Mở cài đặt',
    'about.shortcut.fullscreen': 'Bật/tắt toàn màn hình',
  },
} satisfies Record<Language, Record<string, string>>

export type TranslationKey = keyof typeof translations.en

export function t(lang: Language, key: TranslationKey): string {
  return translations[lang]?.[key] ?? translations.en[key] ?? key
}

/**
 * Hook-style helper for use in components
 */
export function useTranslation(lang: Language) {
  return {
    t: (key: TranslationKey) => t(lang, key),
    lang,
  }
}
