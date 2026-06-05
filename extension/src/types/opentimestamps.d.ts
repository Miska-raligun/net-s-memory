// The `opentimestamps` package ships no types. It is used only as a
// test-time oracle (src/lib/ots/serialize.test.ts) to cross-validate our
// hand-rolled .ots codec; the extension runtime does not depend on it.
declare module "opentimestamps";
