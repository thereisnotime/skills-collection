# Crypto — Lattice / AGCD / Algebraic Factoring Patterns

When a HTB Crypto challenge ships RSA-style code with extra structure (multi-prime, related primes, hint files, shifted moduli, partial leaks), the answer is usually a small lattice or a clever algebraic identity — not Coppersmith small-roots, not factordb.

## Detection cues

- Multiple primes with a common substructure (`p_i = a_i·r + b_i` with bounded `b_i`).
- Public modulus `n = p·q` with both factors sharing a hidden parameter.
- Plaintext or padding leaks (e.g. low-bits known, partial-key known) — Coppersmith small-roots territory.
- Hash/cipher built from XOR + permutation only — see `crypto-linear-collapse.md`.
- Service that returns `enc(plaintext_chosen)` repeatedly — chosen-ciphertext / oracle attacks.

## Pattern 1 — Approximate-GCD (AGCD / DGHV) lattice

When `p_i = a_i·r + b_i` with `|b_i| ≪ r ≪ a_i`:

```
Build the matrix
[ ρ   p_1   p_2   ...   p_m ]   ← b·m·ρ rows down to row 0
[     -p_0                  ]
[          -p_0             ]
[                ...         ]
[                       -p_0]
```
where `ρ ≈ 2^(size of b_i)`. LLL-reduce — the shortest vector encodes `r` directly. m=20–30 noisy samples are typically enough for r at 512–640 bits.

Library: `fpylll` (Python bindings to fplll). Runs in <1 s for n≤30 dim 30 lattice.

## Pattern 2 — Discriminant-square algebraic factoring

When **n = p·q** with both `p = a_p·r + b_p`, `q = a_q·r + b_q` and `r` already recovered:

Decompose `n = A·r² + B·r + C` over the integers (long division). With unknowns `u = a_p·b_q`, `v = a_q·b_p`:

```
B = a_p·a_q·δ + (u + v)        (δ = unknown small carry, 0..3)
C = b_p·b_q
A = a_p·a_q
```

So `(u, v)` are roots of `x² − (B − δ·r)·x + (A·C) = 0` (sometimes with `δ·r` shift depending on borrow). Sweep `δ ∈ {0, 1, 2, 3}` and for each, check whether the discriminant `(B − δr)² − 4·A·C` is a perfect square. Exactly one `δ` works. Recover `u`, then `a_p = gcd(A, u)`, then `p = a_p·r + (n − a_p·something)`. Verify with `n % p == 0`.

Both `r` recovery and `p,q` recovery run in well under a second of pure Python (gmpy2/sympy).

## Pattern 3 — All-zero / all-one coercion of derived keys

When a service exposes a key derivation `k_i = ((x_i · y_i) mod r) mod 2` and you control one factor: pick `y_i = r + 2`. Then `(x_i mod r)·2 < r` for any small `x_i`, so no reduction happens, and the result is always even ⇒ `k_i = 0` regardless of `x_i`. Result: the AES key (or whatever derived-key stream) collapses to all zeros. Decrypt with `b'\x00'*32`.

## Pattern 4 — Multi-prime / common-factor RSA

When you collect many `n_i`, run `gcd(n_i, n_j)` over all pairs. If any pair shares a prime, both are factored instantly. Total work O(m² · cost_of_gcd) for m moduli; for m ≤ 1000 this is seconds.

## Pattern 5 — RSA from `d` only when `phi(n)` is a perfect square

When the modulus is built from `p = a²·g + 1`, `q = b²·g + 1` (or any "structured" choice), then `phi(n) = (p−1)(q−1) = (a·b·g)²` is a perfect square. If you have `d` (or any multiple of `phi`):

1. Scan `k ∈ [1, e)` for `(e·d − 1)/k` being a perfect square. The unique `k` recovers `phi`.
2. Take `√phi`. If small primes were used as `a`, `b`, `g` factors, factor `√phi` with PARI/sympy.
3. Brute-force the partition of those small primes into the three sets `{a, b, g}` (with `g` even, `gcd(a,b)=1`, primality of `a²g+1, b²g+1`) — typically 3^k partitions for k≤15.
4. Recover `n = p·q`; decrypt.

## Pattern 6 — Smooth-order DLP via Pohlig-Hellman (mod p with N−1 fully smooth)

When an oracle returns `g^x mod N` and `N−1` factors as a product of small prime powers (largest prime factor ≤ 2^32):

1. For each prime power `q^e | N−1`, query the oracle with exponent `(N−1)/q^k` for `k = 1..e`.
2. Each query result lives in the order-`q^k` subgroup; lift `x mod q^e` digit-by-digit using BSGS in the small subgroup.
3. CRT-combine to recover `x mod (N−1)`.

For 256-bit primes with 21 small prime factors in `N−1`, total runtime ≤ 60 seconds in pure Python.

**Variant — masked DLP**: If the oracle returns `(g^x mod N) · G` on an elliptic curve (curve point as a "blinder"), recover the curve params first by GCD'ing cubic relations across many decrypted oracle points (`y² − x³ − a·x − b` over many points share a common factor), then strip the blinder via curve arithmetic and proceed with Pohlig-Hellman on the inner DLP.

## Pattern 7 — Differential Fault Attack (DFA) on AES

When a service exposes both a correct and a faulty ciphertext under the same persistent key, with the fault injected between round-9 ShiftRows and round-9 MixColumns:

- **Piret–Quisquater single-byte DFA** recovers the entire round-10 AES key from a handful of fault pairs (typically 4–80 pairs depending on noise).
- AES key schedule is bijective; from round-10 key invert back to the master key.
- Decrypt the flag-bearing ciphertext with standard AES.

Recipe:
1. Collect `(C, C')` pairs where `C'` differs from `C` due to a single-byte fault.
2. For each of the 4 columns of round-10 (the four diagonals of the AES state), enumerate the 256⁴ candidates for the four round-key bytes that map both ciphertexts back through `InvShiftRows∘InvSubBytes` and check the fault pattern matches Piret–Quisquater's predicted four-byte differential.
3. Intersection of solutions across pairs collapses to a unique key column; ~4 pairs suffice per column with no noise.
4. Implement the inverse key schedule to recover the master key.

No external crypto libs needed — the entire attack fits in ~200 lines of pure Python with a precomputed S-box / inverse S-box.

## Past solves

- HTB **Raining Primes** (id=839, Hard) — 30 rain primes `p_i = a_i·r + b_i` with `|b_i| < 2^256`, `r` 640-bit. AGCD lattice recovered `r` in 0.1s. AES key collapsed to zero via `y = r + 2`. Modulus factored by discriminant-square sweep over `δ ∈ {0..3}`. RSA-decrypt → AES-ECB-decrypt with zero key → flag.
- HTB **Wonky AES** (id=550, Insane) — `enc_fault.c` injects a single-byte fault between round-9 ShiftRows and round-9 MixColumns, exposes correct + faulty ciphertext for the same persistent key. Piret–Quisquater DFA, 80 fault pairs, recovered round-10 key, inverted key schedule, AES-ECB-decrypted 3 flag blocks. ~30s end-to-end against live oracle.
- HTB **MadMath** (id=1156, Hard) — Two-stage. **Stage 1**: `gen()` builds primes as `a²g+1, b²g+1`; `phi = (abg)²` is a perfect square. Recovered `phi` from `d` by scanning k for `(ed−1)/k` square, factored √phi via PARI, brute-forced 3^11 partitions to recover `n`, RSA-decrypted to get AES passphrase. **Stage 2**: 256-bit prime `N` with `N−1` fully smooth (largest factor 4.08e8); oracle returns `(FLAG^exp mod N)·G` on elliptic curve. Recovered curve params via cubic-relation GCD across decrypted points, queried 21 exponents, Pohlig-Hellman + BSGS on the inner DLP, total ~64s.

## Anti-patterns

- Don't reach for SageMath unless you actually need it — fpylll + gmpy2 + Python is enough for AGCD up to ~700 bits and most algebraic factoring.
- Don't try to brute-force `r` — it's always too large; the lattice is the point.
- Don't ignore "extra" hints in the protocol (e.g. multiple primes published per round). They're the sample set for the lattice.
