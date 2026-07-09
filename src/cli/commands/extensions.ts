export async function extensionsCommand() {
  console.log(`
  Grabr Browser Extensions

  Capture downloads and route them directly to the Grabr daemon.

  ┌──────────┬────────────────────────────────────────────────────────────┬──────────┐
  │ Browser  │ Store Link                                                │ Status   │
  ├──────────┼────────────────────────────────────────────────────────────┼──────────┤
  │ Firefox  │ https://addons.mozilla.org/fr/firefox/addon/grabr-integration/ │ ✓ Live   │
  │ Chrome   │ —                                                         │ 🔜 Soon  │
  │ Edge     │ —                                                         │ 🔜 Soon  │
  └──────────┴────────────────────────────────────────────────────────────┴──────────┘

  Manual install instructions: grabr --help
  `);
}
