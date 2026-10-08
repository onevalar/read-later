import Foundation

/// 与电脑插件、手机网页使用同一个云端项目。这两个值都是公开参数（不是密钥）。
enum Config {
    static let supabaseURL = URL(string: "https://btetqmmdsugfbyklasuq.supabase.co")!
    static let publishableKey = "sb_publishable_lCEM1hdA5xVA8iwcNfWHdw_CrqRCHb9"
    static let libraryWebURL = URL(string: "https://anvalar-read-later.pages.dev")!
    static let operationsTable = "reading_operations"
}
