import SwiftUI

/// Pills under the search results' title line: where the text was found, and how many results found it there (owner, 2026-11-24,
/// mock `#/search-fields`). System toggle buttons in the default look (capsule, the accent colour when on, dimmed when disabled);
/// nothing custom. A pill with no match is disabled, never hidden, so the three stay where they are while the text changes.
struct SearchFieldPills: View {
    let counts: [SearchField: Int]
    @Binding var chosen: Set<SearchField>

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(SearchField.allCases, id: \.self) { field in
                    let count = counts[field] ?? 0
                    Toggle(isOn: binding(field)) {
                        Text("\(field.label) \(count)")
                    }
                    .toggleStyle(.button)
                    .buttonBorderShape(.capsule)
                    .disabled(count == 0 && !chosen.contains(field))
                    .accessibilityLabel(Text("\(field.label), \(count)"))
                }
            }
            .padding(.horizontal)
        }
        .scrollIndicators(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Found in"))
    }

    private func binding(_ field: SearchField) -> Binding<Bool> {
        Binding(
            get: { chosen.contains(field) },
            set: { on in if on { chosen.insert(field) } else { chosen.remove(field) } }
        )
    }
}

/// A row's second line while searching: the field that matched, with the matching part in the primary colour.
func searchSubtitle(_ item: VaultItem, query: String, chosen: Set<SearchField>) -> Text {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let field = ItemSearch.shownField(of: item, query: query, chosen: chosen),
          let text = field.text(of: item).first(where: { $0.localizedStandardContains(query) }),
          let range = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive])
    else {
        return item.visibleAccount.isEmpty ? Text(item.kind.label) : Text(verbatim: item.visibleAccount)
    }
    return Text(verbatim: String(text[..<range.lowerBound]))
        + Text(verbatim: String(text[range])).foregroundStyle(.primary).fontWeight(.semibold)
        + Text(verbatim: String(text[range.upperBound...]))
}
