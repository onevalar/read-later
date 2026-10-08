import SwiftUI

/// 文章阅读页：站点名、标题、阅读时长、正文；底部"标为已读"。
struct ReaderScreen: View {
    let itemID: String
    let openOriginal: (String) -> Void
    @EnvironmentObject var library: LibraryModel

    private var item: LibraryItem? { library.items.first { $0.id == itemID } }

    var body: some View {
        Group {
            if let item {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Text(item.siteName.uppercased()).font(.system(size: 12)).tracking(1).foregroundStyle(.secondary)
                        Text(item.title).font(.system(size: 28, weight: .semibold)).tracking(-0.4)
                        if let minutes = item.readingMinutes { Text("\(minutes) 分钟阅读").font(.footnote).foregroundStyle(.secondary) }
                        Divider().padding(.vertical, 4)
                        ForEach(Array((item.articleText ?? "").split(separator: "\n").enumerated()), id: \.offset) { _, paragraph in
                            Text(String(paragraph)).font(.system(size: 18)).lineSpacing(8)
                        }
                    }
                    .padding(.horizontal, 20).padding(.bottom, 40)
                }
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { openOriginal(item.url) } label: { Image(systemName: "safari") }.accessibilityLabel("打开原文")
                    }
                    ToolbarItemGroup(placement: .bottomBar) {
                        Spacer()
                        Button { library.setRead(item, read: !item.isRead) } label: {
                            Label(item.isRead ? "标为未读" : "标为已读", systemImage: item.isRead ? "circle" : "checkmark")
                        }
                    }
                }
            } else {
                Text("这篇内容已不在阅读库中").foregroundStyle(.secondary)
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}
