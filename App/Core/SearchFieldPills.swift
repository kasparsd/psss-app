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
    let account = DisplayText.safe(item.visibleAccount)
    let plain = account.isEmpty ? Text(item.kind.label) : Text(verbatim: account)
    guard let field = ItemSearch.shownField(of: item, query: query, chosen: chosen),
          let found = field.text(of: item).first(where: { $0.localizedStandardContains(query) })
    else { return plain }
    // The longer limit, so a match far into a website is still in the line; the row cuts what does not fit.
    let text = DisplayText.value(found)
    guard let range = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) else {
        return text.isEmpty ? plain : Text(verbatim: text)
    }
    return emphasized(text, range)
}

/// `text` with the part that holds `query` in bold and the primary colour, or the plain text when it does not hold it. Case and
/// diacritics are ignored, as in the search. For a row's name while searching.
func highlighted(_ text: String, query: String, breaksAfterDots: Bool = false) -> Text {
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !query.isEmpty, let range = text.range(of: query, options: [.caseInsensitive, .diacriticInsensitive]) else {
        return Text(verbatim: breaksAfterDots ? text.breakableAfterDots : text)
    }
    return emphasized(text, range, breaksAfterDots: breaksAfterDots)
}

private func emphasized(_ text: String, _ range: Range<String.Index>, breaksAfterDots: Bool = false) -> Text {
    func part(_ s: Substring) -> String { breaksAfterDots ? String(s).breakableAfterDots : String(s) }
    // Interpolated, not joined with +, which is deprecated; the surrounding font still applies to every part.
    return Text("\(Text(verbatim: part(text[..<range.lowerBound])))\(Text(verbatim: part(text[range])).foregroundStyle(.primary).fontWeight(.semibold))\(Text(verbatim: part(text[range.upperBound...])))")
}
