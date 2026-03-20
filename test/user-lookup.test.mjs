import test from "node:test";
import assert from "node:assert/strict";

import { buildLookupUsersResults } from "../portable/nostr-cms-core.js";

test("lookup user results keep the canonical visible user and surface removed duplicates separately", () => {
  const canonicalPubkey = "a".repeat(64);
  const removedPubkey = "b".repeat(64);
  const state = {
    users: [
      {
        pubkey: canonicalPubkey,
        username: "aux",
        claimedUsername: "aux",
        usernameConflict: false,
        displayName: "aux"
      }
    ],
    removedUsers: [
      {
        pubkey: removedPubkey,
        claimedUsername: "aux",
        displayName: "aux 2"
      }
    ]
  };

  const results = buildLookupUsersResults(state, {
    matchedPubkeys: [canonicalPubkey],
    includePubkeys: [removedPubkey]
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].pubkey, canonicalPubkey);
  assert.equal(results[0].removed, undefined);
  assert.equal(results[1].pubkey, removedPubkey);
  assert.equal(results[1].removed, true);
  assert.equal(results[1].claimedUsername, "aux");
});

test("lookup user results can return a directly queried removed pubkey", () => {
  const removedPubkey = "c".repeat(64);
  const state = {
    users: [],
    removedUsers: [
      {
        pubkey: removedPubkey,
        claimedUsername: "aux",
        displayName: "aux 3"
      }
    ]
  };

  const results = buildLookupUsersResults(state, {
    matchedPubkeys: [],
    includePubkeys: [removedPubkey]
  });

  assert.deepEqual(results, [
    {
      pubkey: removedPubkey,
      claimedUsername: "aux",
      displayName: "aux 3",
      username: "",
      usernameConflict: false,
      removed: true
    }
  ]);
});
