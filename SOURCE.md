# Source and Licensing

Public Pokemon data and multipliers come from pvpoke/pvpoke (MIT); its original
license is preserved byte-for-byte in baseline/PVPoke-LICENSE.txt and every pack.
Pokemon names remain the property of their respective owners; this is unofficial.

The minimal shared graph transform was supplied by the repository owner from
iv-lab/scripts/evolution-metadata.mjs. No app-wide LICENSE file was present.
The owner-authorized standalone transform and tools are distributed under this
repository's MIT LICENSE; no private application code, calculation engine,
screenshots, user records, or unrelated assets are copied.

Changes to the shared transform: source commit is an explicit parameter rather
than a module constant; the stats-error wording no longer says "pinned".
All filters and graph corrections retain the app behavior:

- Exclude mega, supermega and primal tags, plus mega/primal ID components.
- Correct rockruff's upstream lycranroc_dusk typo to lycanroc_dusk.
- Remap shadow evolutions to available shadow targets; report unavailable ones.
- Omit the known missing scyther_shadow/kleavor_shadow,
  girafarig_shadow/farigiraf_shadow and stantler_shadow/wyrdeer_shadow edges only
  while their targets do not exist. Newly added targets are retained automatically.
- Fail unresolved edges, cycles, invalid stats, duplicate IDs or lost known branches.

baseline/ is exactly the four approved generated Android data assets at PvPoke
04ee0835e80f30c45376415725c0039cbdd12c5e, not an app directory copy.
test/fixtures contains only public Pokemon stats, CPMs and 147 numerical oracle
rows produced by the existing app's TypeScript engine. These frozen fixtures test
the mathematical contract independently of changing candidate Pokemon stats.
The 32,946-row ranking oracle and application ranking engine are deliberately not
forked here: ranking implementation parity remains an application responsibility.
