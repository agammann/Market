# Market design and research

The visual reference is [catalog-final.png](catalog-final.png). The implementation appears in [catalog-rendered.png](catalog-rendered.png) and [catalog-mobile.png](catalog-mobile.png). The catalog is actually empty, with no invented listings or sales. The product name is Market.

## Research basis

Figure 1, page 4 of [Soska and Christin's USENIX Security 2015 study](https://www.usenix.org/system/files/conference/usenixsecurity15/sec15-paper-soska-updated.pdf) contains historical Silk Road, Agora and Evolution screenshots, which were visually inspected. Useful patterns included compact navigation, a category sidebar, prominent search, bordered content panels and visible seller information. No illicit product content or branding was copied.

This is historical interface research, not a current ranking or recommendation of onion marketplaces. The generated reference adapts those catalog patterns to ordinary physical products and digital downloads.

## Visual contract

Deep teal header/footer (#173f3f), green actions (#27845e), pale canvas (#f3f6f5), white panels, muted blue gray text and fine borders. Local Arial/Helvetica/system sans fonts, 16px base controls, 40px catalog heading and 5px button corners. No remote fonts or assets.

Desktop: 80px masthead, Market wordmark, Browse / Orders / Sell / Account navigation, and Sign in. A left category column and filters support the main catalog, search, sorting and bordered empty state with an outlined shopping bag. BTC and XMR are the only asset filters. Mobile wraps navigation and stacks the sidebar, forms and catalog. Functional forms use the same panels and colors.

## Fidelity ledger

| Area         | Comparison                                                                                                                 |
| :----------- | :------------------------------------------------------------------------------------------------------------------------- |
| Hierarchy    | Header, sidebar, search and empty state follow the concept                                                                 |
| Copy         | Functional catalog copy and BTC/XMR match; user selected Market casing and a privacy footer link are intentional additions |
| Colors       | Teal, green, white and gray match                                                                                          |
| Typography   | Sans type and compact spacing match; browser font metrics differ slightly                                                  |
| Illustration | Local outlined shopping bag follows the reference                                                                          |
| Responsive   | Desktop and 390px mobile inspected without horizontal overflow                                                             |

The concept and rendered captures were opened for visual comparison. No material structural mismatch remained. This is a functional adaptation, not a pixel identity claim.
