# Random

`Random` は、OS カーネルのエントロピー源から取得する暗号論的乱数（`IO` アクション）と、シードから決定論的に乱数列を生成する純粋な PCG 擬似乱数生成器 `Random.Pcg` の 2 系統を提供する標準モジュールです。暗黙のグローバル乱数状態は存在しません。

OS 乱数（`Random.bytes`・`Random.next_u64`）にはパッケージ権限 `random` が必要です。純粋関数の `Random.pcg`・`Random.pcg_next_u32`・`Random.pcg_next_u64` には権限は不要であり、`pure def` 内や既定の `wasm32` でも使用できます。

## 要点

- 暗号鍵・トークン・予測不能なシードの取得には OS エントロピー乱数 `Random.bytes` / `Random.next_u64` を使用します。
- テストやシミュレーションで再現可能な乱数列が必要な場合は `Random.Pcg`（PCG-XSH-RR 64/32）を使用します。
- `Random.Pcg` は不変・不透明な `Copy` 値です。呼び出しのたびに「生成された乱数値」と「状態が 1 ステップ進んだ新しい `Pcg`」のタプルが返るため、次の呼び出しには返却された新しい `Pcg` を渡します。
- `Random.bytes` の要求バイト数が負または $2^{30}$（1 GiB）を超える場合は `Os.ErrorKind.InvalidInput` となります。

## OS エントロピー乱数

`Random.bytes count` は OS の暗号論的擬似乱数生成器（CSPRNG）から `count` バイトを取得します（`count == 0` は空配列 `Ok []` で成功します）。`Random.next_u64 ()` は 8 バイトを取得してリトルエンディアンの `i64u` に変換します。

```tsuzuri run=0%0A16%0Ainvalid%20input%0Aok
def main :: unit -> i32 = \() ->
    let! empty = Random.bytes 0
    do! IO.writeln (match empty with
        | Result.Ok data -> $"{data.length}"
        | Result.Error error -> Os.message error)
    let! key = Random.bytes 16
    do! IO.writeln (match key with
        | Result.Ok data -> $"{data.length}"
        | Result.Error error -> Os.message error)
    let! negative = Random.bytes (-1)
    do! IO.writeln (match negative with
        | Result.Ok _ -> "unexpected"
        | Result.Error error -> Os.message error)
    let! word = Random.next_u64 ()
    do! IO.writeln (if Result.is_ok (ref word) then "ok" else "failed")
    0
```

## 決定論的擬似乱数生成器 `Random.Pcg`

`Random.pcg seed sequence` はリファレンス実装 `pcg-c-basic` の `pcg32_srandom_r` とビット単位で互換な PCG-XSH-RR 64/32 生成器を初期化します。ストリーム番号 `sequence` は内部で `(sequence <<< 1) | 1` として奇数増分に変換されるため、どの `sequence` を渡しても完全周期が保証されます。内部フィールドは不透明（`E1022`）です。

```mermaid
flowchart LR
    init["Random.pcg seed sequence"] --> g0["Pcg (step 0)"]
    g0 --> next1["Random.pcg_next_u32"]
    next1 --> out1["(value1, g1)"]
    out1 --> next2["Random.pcg_next_u32 g1"]
    next2 --> out2["(value2, g2)"]
```

同じ `Pcg` 値を再度渡すとまったく同じ値が得られます。ループ内で乱数列を進める場合は `let mut rng = ...` に返却された次の `Pcg` を再代入します。`pcg_next_u64` は `pcg_next_u32` を 2 回進め、1 回目を上位 32 ビット、2 回目を下位 32 ビットに結合します。

```tsuzuri run=2707161783%202068313097%0Atrue%0A11627171325034361865
pure def two_u32 :: i64u -> i64u -> (i32u * i32u)
fn two_u32 seed seq =
    let rng0 = Random.pcg seed seq
    let (first, rng1) = Random.pcg_next_u32 rng0
    let (second, _) = Random.pcg_next_u32 rng1
    (first, second)

def main :: unit -> i32 = \() ->
    let (a, b) = two_u32 42i64u 54i64u
    do! IO.writeln $"{a} {b}"
    let same = Random.pcg 42i64u 54i64u
    let (x, _) = Random.pcg_next_u32 same
    let (y, _) = Random.pcg_next_u32 same
    do! IO.writeln $"{x == y}"
    let (wide, _) = Random.pcg_next_u64 (Random.pcg 42i64u 54i64u)
    do! IO.writeln $"{wide}"
    0
```

> **補足**: `Random.Pcg` は統計的品質と再現性を目的とした非暗号論的擬似乱数生成器です。セキュリティ用途には必ず `Random.bytes` または `Random.next_u64` を使用してください。

## 対応環境

- **`Random.Pcg`（純粋関数群）**: OS 呼び出しやホストインポートを一切行わないため、ネイティブ 5 環境と既定の `wasm32` / `wasm64`、`-O0` と `-O3` のすべてで完全に同一の乱数列を生成します。
- **`Random.bytes` / `Random.next_u64`**:
  - ネイティブ環境では OS の CSPRNG（Linux `getrandom`、macOS `arc4random_buf` / システムエントロピー、Windows `BCryptGenRandom`）から取得します。
  - 既定の `wasm32` ターゲットでは到達時に `E2000` で拒否され、`--wasm-host wasi` 指定時は WASI preview1 の `random_get` にコンパイルされます（[WebAssembly](../../compiler/webassembly.md)）。

## 引数の順序

標準ライブラリの設計規約（[標準ライブラリの規約](../conventions.md)）に従い、状態を変換する `pcg_next_u32` と `pcg_next_u64` は対象となる `Random.Pcg` を最後の引数に取ります。`Random.pcg seed sequence` は `Pcg` を新規構築するコンストラクタ関数です。

## 公開 API

### 型定義

```text
record Pcg // 不透明（opaque）、Copy
```

### OS エントロピー乱数（2 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Random.bytes` | `own i64 -> IO<Result<[ubyte], Os.Error>>` | OS から暗号論的乱数を `count` バイト取得（範囲 `0..=2^30` 外は `InvalidInput`） |
| `Random.next_u64` | `own unit -> IO<Result<i64u, Os.Error>>` | OS の 8 バイト乱数をリトルエンディアンの `i64u` として取得 |

### 決定論的 PCG 擬似乱数生成器（3 関数、`pure def`）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Random.pcg` | `own i64u -> own i64u -> Random.Pcg` | シード値とストリーム番号から PCG-XSH-RR 64/32 生成器を構築 |
| `Random.pcg_next_u32` | `own Random.Pcg -> (i32u * Random.Pcg)` | 次の 32 ビット符号なし整数と、1 ステップ進んだ `Pcg` を返す |
| `Random.pcg_next_u64` | `own Random.Pcg -> (i64u * Random.Pcg)` | 2 回分の出力を結合した 64 ビット符号なし整数と、2 ステップ進んだ `Pcg` を返す |

## 関連項目

- [IO](./io.md)
- [Os](./os.md)
- [Gen](../testing/gen.md)
- [HashMap](../collections/hashmap.md)
- [標準ライブラリの規約](../conventions.md)
- [WebAssembly](../../compiler/webassembly.md)
