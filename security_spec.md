# Firestore Security Specification — KinoScope Studio

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every document in `/analyses/{analysisId}` and `/sceneBreakdowns/{breakdownId}` belongs exclusively to a single authenticated user (`ownerId == request.auth.uid`) with a verified email (`request.auth.token.email_verified == true`).
2. **Immutable Ownership & Creation Metadata**: Once created, `ownerId`, `videoId`, and `createdAt` can never be mutated during an `update`.
3. **Server-Enforced Temporal Integrity**: `createdAt` must equal `request.time` on creation, and `updatedAt` must equal `request.time` on both creation and updates.
4. **Strict Schema & Key Whitelisting**: Documents must contain all required keys and only allowed keys (`hasAll` + `hasOnly`), with strict `.size()` bounds on every string and array field and regex validation (`^[a-zA-Z0-9_\-]+$`) on all document IDs and `ownerId`.
5. **Query Enforcer on List Operations**: `allow list` rules explicitly enforce `resource.data.ownerId == request.auth.uid`, preventing cross-tenant query scraping.

## 2. The "Dirty Dozen" Payloads

1. **Identity Spoofing on Create**: Authenticated user `user_A` attempts to create `/analyses/ans_1` with `ownerId: "user_B"`.
2. **Unverified Email Write**: Authenticated user `user_A` with `email_verified: false` attempts to create `/analyses/ans_1`.
3. **Shadow Field Injection on Create**: Payload includes all required fields plus `"isAdmin": true`.
4. **Missing Required Field on Create**: Payload omits `answer` or `thinkingLevel`.
5. **Document ID Poisoning**: Creating `/analyses/invalid$id!with@spaces` or an ID exceeding 128 characters.
6. **Denial-of-Wallet Oversized Prompt/Answer**: Payload where `prompt.size() > 4000` or `answer.size() > 50000`.
7. **Forged Client Timestamp**: Payload where `createdAt` or `updatedAt` does not match `request.time`.
8. **Ownership Hijack on Update**: Updating `/analyses/ans_1` to change `ownerId` or `createdAt`.
9. **Unauthorized Update Action**: Updating `/analyses/ans_1` to mutate `videoId` or inject an unapproved key.
10. **Value Poisoning on Update**: Updating `prompt` to a boolean `true` or an empty string `""`.
11. **Unbounded Array Injection on SceneBreakdowns**: Creating `/sceneBreakdowns/bd_1` with `scenes` containing 51 items or non-map elements.
12. **Cross-User Read/List Scraping**: Authenticated user `user_B` attempting `get` or `list` on `user_A`'s `/analyses` or `/sceneBreakdowns` documents.
