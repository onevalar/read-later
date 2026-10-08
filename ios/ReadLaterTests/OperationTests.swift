import XCTest
@testable import ReadLater

final class OperationTests: XCTestCase {
    func testCreateOperationMatchesWebFormat() throws {
        let op = LibraryOperation.create(pageId: "page-1", operationId: "op-1", url: URL(string: "https://mp.weixin.qq.com/s/a?b=1")!, title: "标题 \"quoted\"",
                                         articleText: "正文\n第二段", savedAt: Date(timeIntervalSince1970: 1_790_000_000.123), autoTags: ["📝 Article"])
        let json = try op.serialized()
        // 键按字母排序、斜杠不转义、紧凑输出，与网页端 serializeOperation 一致
        XCTAssertTrue(json.hasPrefix("{\"at\":1790000000123,\"id\":\"op-1\",\"kind\":\"create\",\"patch\":{\"articleText\""), json)
        XCTAssertTrue(json.contains("\"url\":\"https://mp.weixin.qq.com/s/a?b=1\""))
        XCTAssertTrue(json.contains("\"visitedAt\":null"))
        XCTAssertTrue(json.contains("\"tags\":[]"))
        if let path = ProcessInfo.processInfo.environment["RL_DUMP_OPERATION"] ?? (try? String(contentsOfFile: "/tmp/rl-dump-path"))?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty {
            try json.write(toFile: path, atomically: true, encoding: .utf8)
        }
    }
}
