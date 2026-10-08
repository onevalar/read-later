import Foundation

// MARK: - 阅读库里的一篇文章

struct LibraryItem: Identifiable, Equatable {
    var id: String
    var url: String
    var title: String
    var savedAt: Int64            // 毫秒
    var visitedAt: Int64?
    var notes: String?
    var progress: Double?
    var articleText: String?

    var isRead: Bool { visitedAt != nil }
    var host: String { URL(string: url)?.host?.replacingOccurrences(of: "www.", with: "") ?? url }

    /// 列表里显示的来源名：微信文章显示"微信公众号"，其余显示域名。
    var siteName: String { host.hasSuffix("mp.weixin.qq.com") ? "微信公众号" : host }

    /// 方块里的字：微信用"微"，其余取主域名的首字母（跳过 www / m / mp 这类前缀）。
    var initial: String {
        if host.hasSuffix("weixin.qq.com") { return "微" }
        let skip: Set<String> = ["www", "m", "mp", "mobile", "amp"]
        let labels = host.split(separator: ".").map(String.init)
        let main = labels.dropLast().first { !skip.contains($0) } ?? labels.first ?? "·"
        return String(main.prefix(1)).uppercased()
    }
    var savedDate: Date { Date(timeIntervalSince1970: Double(savedAt) / 1000) }
    var readingMinutes: Int? { articleText.map { max(1, Int((Double($0.count) / 900).rounded(.up))) } }
}

// MARK: - 本机保存的记录

/// 云端只追加不修改的"操作记录"。本机保留一份完整副本，离线也能看；还没上传的标记 pushed = false。
struct StoredOp: Codable, Equatable {
    var id: String
    var at: Int64
    var payload: String
    var pushed: Bool
}

struct LocalLibrary: Codable, Equatable {
    var userId: String?
    var ops: [StoredOp] = []
    var cursor: String?
    var lastSyncedAt: Date?
}

protocol LibraryPersisting {
    func load() -> LocalLibrary
    func save(_ library: LocalLibrary)
}

struct FileLibraryPersistence: LibraryPersisting {
    var fileURL: URL = {
        let base = (try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)) ?? FileManager.default.temporaryDirectory
        return base.appendingPathComponent("library.json")
    }()

    func load() -> LocalLibrary {
        guard let data = try? Data(contentsOf: fileURL), let library = try? JSONDecoder().decode(LocalLibrary.self, from: data) else { return LocalLibrary() }
        return library
    }

    func save(_ library: LocalLibrary) {
        guard let data = try? JSONEncoder().encode(library) else { return }
        try? data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

// MARK: - 把操作记录还原成文章列表（规则与网页端 materializeOperations 相同）

enum LibraryMaterializer {
    static func materialize(_ ops: [StoredOp]) -> [LibraryItem] {
        struct Parsed { let at: Int64; let id: String; let kind: String; let url: String; let patch: [String: Any] }
        var parsed: [Parsed] = []
        for op in ops {
            guard let object = (try? JSONSerialization.jsonObject(with: Data(op.payload.utf8))) as? [String: Any],
                  let kind = object["kind"] as? String, let url = object["url"] as? String else { continue }
            parsed.append(Parsed(at: op.at, id: op.id, kind: kind, url: url, patch: object["patch"] as? [String: Any] ?? [:]))
        }
        parsed.sort { (a: Parsed, b: Parsed) -> Bool in a.at != b.at ? a.at < b.at : a.id < b.id }

        var library: [String: [String: Any]] = [:]
        for op in parsed {
            if op.kind == "delete" { library[op.url] = nil; continue }
            if op.kind == "patch" && library[op.url] == nil { continue }
            var record = library[op.url] ?? [:]
            for (key, value) in op.patch {
                if value is NSNull { record[key] = nil } else { record[key] = value }
            }
            library[op.url] = record
            library[op.url]?["url"] = op.url
        }

        var items: [LibraryItem] = []
        for (url, record) in library {
            guard let id = record["id"] as? String, let title = record["title"] as? String,
                  let saved = (record["savedAt"] as? NSNumber)?.int64Value else { continue }
            items.append(LibraryItem(id: id, url: url, title: title, savedAt: saved,
                                     visitedAt: (record["visitedAt"] as? NSNumber)?.int64Value,
                                     notes: record["notes"] as? String,
                                     progress: (record["progress"] as? NSNumber)?.doubleValue,
                                     articleText: record["articleText"] as? String))
        }
        return items.sorted { $0.savedAt > $1.savedAt }
    }
}

// MARK: - 显示用的日期：今天 / 昨天 / 几月几日（不会自己跳动）

enum DayLabel {
    static func text(for date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
        if days <= 0 { return "今天" }
        if days == 1 { return "昨天" }
        let parts = calendar.dateComponents([.month, .day], from: date)
        return "\(parts.month ?? 1) 月 \(parts.day ?? 1) 日"
    }
}

extension LibraryItem: Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(id) }
}
