# Alloc

`Alloc` は、計数アロケータ（counting allocator）が記録するヒープの確保回数・再確保回数・解放回数・要求バイト数を読み取る opt-in 標準モジュールです。実行時間のようにマシン負荷で揺らぐ指標ではなく、「借用スライスはヒープ確保を行わない」「一意な所有配列の更新は in-place で行われる」といったメモリ確保契約を決定論的にテストするために用います。

ソースコード中に `Alloc` 識別子が現れたときのみ読み込まれます。`tsuzuri test` では対象テストが `Alloc` に到達するとき自動的に計数アロケータがリンクされます。

## 要点

- `Alloc.Stats { allocs, reallocs, frees, bytes }` の 4 カウンタでヒープ操作の差分を観測します。
- `Alloc.snapshot ()` と `Alloc.since start` で任意のコード区間の確保差分を取得し、`Alloc.measure (\() -> ...)` でクロージャ実行の差分と戻り値を同時に取得します。
- カウンタ読み取り自体はヒープ確保を一切発生させません（計測区間の入れ子も可能です）。
- 所有値を消費して in-place 更新させる操作を測る際は、クロージャ捕捉による一意性喪失を避けるため `measure` ではなく `snapshot` と `since` を使います。
- `tsuzuri build` / `run` で `Alloc` を使う場合は明示的に `--allocator counting` の指定が必要です（未指定時は `E1018`）。また、`pure def` 内からの呼び出しはデバッグ効果違反（`E1029`）となります。

## ヒープ確保回数・バイト数の検証パターン

### 1. `snapshot` と `since` による区間計測（所有値の消費・in-place 更新を含む場合）

所有配列 `xs` を `Array.update_at` などで消費する処理では、クロージャで `xs` を捕捉すると一意参照でなくなりコピー確保が発生してしまいます。そのようなケースでは `Alloc.snapshot ()` と `Alloc.since` で直接挟んで計測します。

```tsuzuri project=alloc_test file=AllocTest.tz
test "借用に対する Array.map は結果配列の 1 ブロックのみ確保する" =
    let xs = new [i64](10, \i -> i)
    let start = Alloc.snapshot ()
    let ys = Array.map (\x -> x + 1) xs
    let used = start |> Alloc.since
    Test.is_true (used.allocs == 1 && used.reallocs == 0 && used.frees == 0 && used.bytes == 80)
    Test.equal (ref 10) (ref ys[9])

test "一意な所有配列の Array.update_at は無確保で in-place 更新される" =
    let xs = new [i64](4, \i -> i)
    let start = Alloc.snapshot ()
    let ys = Array.update_at 0 99 xs
    let used = Alloc.since start
    Test.is_true (used.allocs == 0 && used.reallocs == 0 && used.bytes == 0)
    Test.equal (ref 99) (ref ys[0])
```

### 2. `Alloc.measure` による結果と統計の同時取得

外部の所有値を消費しない計算であれば、`Alloc.measure` で `(Alloc.Stats * 'a)` のタプルとして簡潔に受け取れます。戻り値 `'a` はタプルに格納されて返るため、戻り値のスコープ終了に伴う `frees` は `measure` の計測窓の外側になります。

```tsuzuri project=alloc_measure file=AllocMeasure.tz
test "Vec.with_capacity で事前確保すれば push で再確保が起きない" =
    let (used, items) = Alloc.measure (\() -> {
        let mut v: Vec<i64> = Vec.with_capacity 16;
        for i in 0i64 ..< 16i64 do
            v = Vec.push_owned i v;
        v
    })
    Test.is_true (used.allocs == 1 && used.reallocs == 0 && used.bytes == 128)
    Test.equal (ref 16) (ref (Vec.length items))
```

> **計測時の注意**: 計測区間内に `$"..."` 文字列補間や `Debug.print` を挿入すると、その文字列バッファ確保もカウンタに加算されます。アサーションや文字列フォーマットは `Alloc.since` の後に置いてください。また、同じ関数内の後続箇所でローカル配列を借用していると「最後の使用におけるムーブ最適化」が抑止されて複製確保が入ることがあります。

## カウンタの定義と集計規則

```text
record Stats { allocs: i64, reallocs: i64, frees: i64, bytes: i64 }
```

ランタイムのヒープ関数（`@tz.alloc`・`@tz.realloc`・`@tz.free`、およびホスト向け `tsuzuri_alloc`）の呼び出しが次のように記録されます。

| ヒープイベント | `allocs` | `reallocs` | `frees` | `bytes` |
| --- | --- | --- | --- | --- |
| 新規確保 `alloc(size)` | `+1` | `0` | `0` | `+size` |
| `null` ポインタから正サイズへの `realloc` | `+1` | `0` | `0` | `+新サイズ` |
| 生存ブロックの正サイズへの `realloc` | `0` | `+1` | `0` | `+新サイズ` |
| 生存ブロックの `free`、またはサイズ `0` への `realloc` | `0` | `0` | `+1` | `0` |
| `null` ポインタの `free` | `0` | `0` | `0` | `0` |

- `bytes` は要求サイズの累積和です（計数アロケータ内部の 16 バイトヘッダは含まず、`realloc` 時は増分ではなく新しいブロックサイズ全体が加算され、`free` で減算されません。現在使用中バイト数やピーク使用量ではありません）。
- カウンタはプロセス全体で共有されるアトミック変数です。単一スレッドの決定論的な処理では毎回同じ値になりますが、`tzroutine` や `Parallel` ワーカースレッドが並行動作している場合は他スレッドの確保も合算されます（外部 C ライブラリが直接呼ぶ `malloc` は含まれません）。

## 利用可能なコマンドと `--allocator` 条件

通常のビルドではオーバーヘッドのない既定アロケータ（`system`）が使われ、計数アロケータは必要なときだけリンクされます。

| コマンド / モード | 動作と要件 |
| --- | --- |
| `tsuzuri test`（ネイティブ / WASM、`--coverage`、`-g` 含む） | 選択されたテストが `Alloc` に到達する場合、自動的に `counting` アロケータをリンク |
| `tsuzuri build` / `tsuzuri run` | `Alloc` に到達する場合は `--allocator counting` の明示が必須（未指定時は `E1018`、`host` / `small` 指定時は `E2000`） |
| `tsuzuri bench`（時間計測実行器） | 到達すると `E1018`（ベンチマークの確保数計測には [`tsuzuri bench --allocs`](./bench.md) を使用） |
| `tsuzuri check` / `tsuzuri doc` | 型検査のみ実施（到達検査はコード生成時に行われる） |

## 引数の順序

標準ライブラリの設計規約（[標準ライブラリの規約](../conventions.md)）に従い、`Alloc.since` は基準となる `Alloc.Stats` を最後の（唯一の）引数に取るため、`start |> Alloc.since` のパイプライン形式で記述できます。

## 公開 API

### 型定義

```text
record Stats { allocs: i64, reallocs: i64, frees: i64, bytes: i64 }
```

### 関数（3 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Alloc.snapshot` | `unit -> Alloc.Stats` | プロセス開始時点からの累積ヒープ統計を取得 |
| `Alloc.since` | `Alloc.Stats -> Alloc.Stats` | 以前の `snapshot` からのフィールドごとの増分を取得 |
| `Alloc.measure` | `(unit -> 'a) -> (Alloc.Stats * 'a)` | クロージャを 1 回実行し、その区間の増分と戻り値のタプルを返す |

## 関連項目

- [Test](./test.md)
- [Bench](./bench.md)
- [Array](../collections/array.md)
- [Vec](../collections/vec.md)
- [String](../text/string.md)
- [Rc と Arc](../memory/rc.md)
- [標準ライブラリの規約](../conventions.md)
- [所有権とムーブ](../../ownership/ownership-and-move.md)
- [メモリレイアウト](../../ownership/memory-layout.md)
- [コンパイラオプション](../../compiler/options.md)
