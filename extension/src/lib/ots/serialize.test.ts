// Cross-validates our hand-rolled .ots codec against the real `opentimestamps`
// library (a devDependency; it runs fine under node where `crypto` exists).
// If these pass, our serializer is byte-compatible with the ecosystem.

import { describe, expect, it } from "vitest";
import OT from "opentimestamps";
import {
  allAttestations,
  deserializeProof,
  serializeProof,
  OP_SHA256,
  type Proof,
} from "./serialize";

/* eslint-disable @typescript-eslint/no-explicit-any */
const { DetachedTimestampFile, Ops, Notary } = OT as any;

const OP_APPEND = 0xf0;

function libProofWith(attach: (tipTs: any) => void): Uint8Array {
  const digest = new Uint8Array(32).fill(0xab);
  const detached = DetachedTimestampFile.fromHash(new Ops.OpSHA256(), Array.from(digest));
  const appended = detached.timestamp.add(new Ops.OpAppend(Array.from(new Uint8Array(16).fill(0x11))));
  const tip = appended.add(new Ops.OpSHA256());
  attach(tip);
  return Uint8Array.from(detached.serializeToBytes());
}

describe("ots codec vs. opentimestamps library", () => {
  it("parses a library-produced pending proof and re-serializes identical bytes", () => {
    const uri = "https://alice.btc.calendar.opentimestamps.org";
    const libBytes = libProofWith((tip) => tip.attestations.push(new Notary.PendingAttestation(uri)));

    const proof = deserializeProof(libBytes);
    expect(proof.fileOpTag).toBe(OP_SHA256);
    expect(proof.fileDigest).toEqual(new Array(32).fill(0xab));

    const atts = allAttestations(proof.timestamp);
    expect(atts).toEqual([{ kind: "pending", uri }]);

    // byte-for-byte round-trip
    expect(Array.from(serializeProof(proof))).toEqual(Array.from(libBytes));
  });

  it("parses a Bitcoin attestation height", () => {
    const libBytes = libProofWith((tip) =>
      tip.attestations.push(new Notary.BitcoinBlockHeaderAttestation(783000)),
    );
    const proof = deserializeProof(libBytes);
    expect(allAttestations(proof.timestamp)).toEqual([{ kind: "bitcoin", height: 783000 }]);
    expect(Array.from(serializeProof(proof))).toEqual(Array.from(libBytes));
  });

  it("produces bytes the library can deserialize", () => {
    const uri = "https://bob.btc.calendar.opentimestamps.org";
    const proof: Proof = {
      fileOpTag: OP_SHA256,
      fileDigest: new Array(32).fill(0xcd),
      timestamp: {
        attestations: [],
        ops: [
          {
            op: { tag: OP_APPEND, arg: new Array(16).fill(0x22) },
            child: {
              attestations: [],
              ops: [
                {
                  op: { tag: OP_SHA256 },
                  child: { attestations: [{ kind: "pending", uri }], ops: [] },
                },
              ],
            },
          },
        ],
      },
    };
    const bytes = serializeProof(proof);
    const libDetached = DetachedTimestampFile.deserialize(Array.from(bytes));
    const libAtts: string[] = [];
    libDetached.timestamp.allAttestations().forEach((att: any) => {
      if (att instanceof Notary.PendingAttestation) libAtts.push(att.uri);
    });
    expect(libAtts).toEqual([uri]);
  });
});
