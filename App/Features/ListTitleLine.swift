import SwiftUI

/// The first line of a list column on Mac and iPad: the list's title and how many rows it holds ("All · 12 items"), and under it what
/// else is in force. It is part of the list, not of the toolbar, which keeps Sort, Filter, Add and search. A plain row: it cannot be selected and has no separator.
struct ListTitleLine: View {
    let title: String
    let count: String
    /// What else is in force (a filter, an order), only when something is. Secondary, one size smaller than the title.
    var detail: String?

    var body: some View {
        // The title and count are one size, with the count in the secondary style; the detail line is body size.
        VStack(alignment: .leading, spacing: 2) {
            Text("\(Text(verbatim: title))\(Text(verbatim: " · ").foregroundStyle(.secondary))\(Text(verbatim: count).foregroundStyle(.secondary))")
                .font(.title2.weight(.semibold))
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            if let detail {
                Text(verbatim: detail)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            #if os(iOS)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 4, trailing: 16))
            #else
            .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 4, trailing: 8))
            #endif
    }
}

extension View {
    /// Mac and iPad show the title in the list itself (`ListTitleLine`), so the column's bar carries no title. iPhone keeps its
    /// navigation title.
    @ViewBuilder
    func columnTitleInList(_ inList: Bool) -> some View {
        if inList {
            #if os(macOS)
            self.toolbar(removing: .title)
            #else
            self.navigationTitle("").navigationBarTitleDisplayMode(.inline)
            #endif
        } else {
            self
        }
    }
}
