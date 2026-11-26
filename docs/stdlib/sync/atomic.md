# Atomic

`Atomic<'a>` は、整数または真偽値 `bool` を格納し、複数の `tzroutine` や OS スレッドから共有借用 `ref Atomic<'a>` を通じてロックフリーに不可分（アトミック）な読み書き・更新を行う共有セルです。カウンタ、完了フラグ、シーケンス番号の採番、CAS（Compare-And-Swap）ループによる統計値の更新など、単一スカラーで完結する共有状態に適しています。

`Atomic` は名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールです。複数の値をまたぐ不変条件の保護や、文字列・コレクション・レコードの共有には [Mutex](./mutex.md) または [RwMutex](./rwmutex.md) を使用します。

## 要点

- 格納可能な要素型 `'a` は組み込み型クラス `AtomicValue<'a>` を満たす 9 型（`i8`・`i16`・`i32`・`i64`・`i8u`・`i16u`・`i32u`・`i64u`・`bool`）に限定される（それ以外の型は `E1005`）。
- すべてのアトミック操作は**逐次一貫性（Sequentially Consistent、`seq_cst`）**のメモリ順序で実行され、弱いメモリ順序によるデータ競合やプラットフォーム間の挙動差を排除している。
- 算術・ビット更新系 `fetch_*` は `Integer<'a>` 制約を要求し、常に**更新前の値**を返す。加減算のオーバーフローは通常の整数演算と同じく 2 の補数でラップアラウンドする。
- `Atomic<'a>` は `Send` かつ `Sync` を満たす非 `Copy` 所有型である。クロージャ環境が複製されると別セルになってしまうため関数値への直接捕捉は `E1005` で禁止されており、複数タスク間では [`Routine.scope`](./routine.md) の共有借用または [`Arc<Atomic<'a>>`](../memory/rc.md) を介して共有する。
- 各操作はランタイム関数呼び出しを介さず、LLVM の単一アトミック命令へ直接インライン展開される。

## 基本的な使い方

`Atomic.create` で初期値を持つセルを作成し、`ref cell` を通じて更新・参照を行います。`Atomic.compare_exchange` は現在の値が期待値 `expected` と一致する場合にのみ `desired` を書き込み、成功時は `Result.Ok 旧値`、不一致時は書き込まずに `Result.Error 現在値` を返します（スプリアス失敗のない強い比較交換）。

```tsuzuri run=prev0%3D0%20prev1%3D10%20swapped%3D25%20cas_ok%3D50%20cas_ng%3D99%20final%3D99
let cell = Atomic.create 0i64
let prev0 = Atomic.fetch_add (ref cell) 10
let prev1 = Atomic.fetch_sub (ref cell) 3
Atomic.store (ref cell) 25
let swapped = Atomic.swap (ref cell) 50
let cas_ok =
    match Atomic.compare_exchange (ref cell) 50 99 with
    | Result.Ok old -> old
    | Result.Error cur -> cur
let cas_ng =
    match Atomic.compare_exchange (ref cell) 50 120 with
    | Result.Ok old -> old
    | Result.Error cur -> cur
$"prev0={prev0} prev1={prev1} swapped={swapped} cas_ok={cas_ok} cas_ng={cas_ng} final={Atomic.load (ref cell)}"
```

整数リテラルは型注釈がない文脈では `i32` に推論されるため、64 ビットカウンタを作る際は `Atomic.create 0i64` のように型サフィックスを明記します。単独所有に戻ったセルからロックなしで中身を回収する場合は `Atomic.into_inner` を呼び出します。

## 並行タスクでの共有と CAS ループ

`Routine.scope` を使うと、スタック上の `Atomic` を共有借用のまま複数の `tzroutine` から同時に更新できます。また、`fetch_*` に直接対応しない演算（最大値の更新や条件付きビット遷移など）は、`Atomic.load` と `Atomic.compare_exchange` を組み合わせた CAS ループで記述します。

```tsuzuri run=hits%3D8%20peak%3D49
def rec update_max :: ref Atomic<i64> -> i64 -> unit
fn rec update_max target candidate =
    let current = Atomic.load target
    if candidate > current then
        match Atomic.compare_exchange target current candidate with
        | Result.Ok _ -> ()
        | Result.Error _ -> update_max target candidate

record Metrics {
    hits: Atomic<i64>,
    peak: Atomic<i64>,
}

let metrics = Metrics {
    hits: Atomic.create 0i64,
    peak: Atomic.create 0i64,
}
let _done = Routine.scope (ref metrics) 8 (\m idx -> {
    let _old = Atomic.fetch_add (ref m.hits) 1;
    update_max (ref m.peak) (idx * idx)
})
$"hits={Atomic.load (ref metrics.hits)} peak={Atomic.load (ref metrics.peak)}"
```

呼び出し元のスコープを超えて生存する `tzroutine { ... }` や `Routine.go` で共有する場合は、`let shared = Arc.new (Atomic.create 0i64)` のように `Arc` に格納し、`Arc.share` で各タスクへ配布して `Arc.get` から操作します。

## 型規則・メモリレイアウト・性能特性

- **不透明表現と ABI 制約**: `Atomic<'a>` の内部表現は不透明であり、フィールド参照・構築・分解は `E1022`、C ABI 境界（`export def` / `extern def`）での使用は `E1008`、`const` 初期化は `E1026` となります。`Eq`・`Ord`・`Hash`・`Display` インスタンスは持たないため、`Atomic.load` で読み出した値に対して比較やフォーマットを行います。
- **ジェネリック関数での制約記述**: 型変数 `'a` に対して `Atomic` を操作する関数を定義する場合は、`AtomicValue<'a>`（算術・ビット演算を行う場合は加えて `Integer<'a>`）を型クラス制約に指定します（`bool` に対する `fetch_add` 等は `E1005` となります）。
- **命令降格とアライメント**: セルの実体は 16 バイト境界に整列されたヒープ領域に 1 回だけ確保されるため、`Atomic<'a>` レコード自体をムーブしてもメモリアドレスは変化しません。ネイティブ環境では `load atomic`・`store atomic`・`atomicrmw`・`cmpxchg`（すべて `seq_cst`、AArch64 の LSE 命令や x86-64 の `lock` プレフィックス命令）へ直接変換されます。WebAssembly では `--wasm-feature threads` 時に WASM アトミック命令へ、既定の単一スレッド構成では通常命令へ変換されます。
- **キャッシュライン競合への配慮**: 同一の `Atomic` セルに対して多数のコアから高頻度で書き込みを行うとキャッシュラインの競合が発生します。ループ内での集計は各タスクのローカル変数で行い、完了時に 1 回だけ `fetch_add` で合算する設計が効果的です。

## 引数の順序

`Atomic` モジュールはリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、`into_inner` を含むすべての操作関数で操作対象のセル `ref Atomic<'a>`（または `Atomic<'a>`）を**第1引数**に取ります（`Atomic.store (ref cell) next`、`Atomic.compare_exchange (ref cell) expected desired`）。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

`Atomic` モジュールの全 11 公開関数の一覧です。

### 生成・読み書き・交換

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `Atomic.create` | `AtomicValue<'a> => 'a -> Atomic<'a>` | 指定した初期値を持つアトミックセルを生成する |
| `Atomic.load` | `AtomicValue<'a> => ref Atomic<'a> -> 'a` | 現在の値をアトミックに読み出す |
| `Atomic.store` | `AtomicValue<'a> => ref Atomic<'a> -> 'a -> unit` | 新しい値をアトミックに書き込む |
| `Atomic.swap` | `AtomicValue<'a> => ref Atomic<'a> -> 'a -> 'a` | 新しい値を書き込み、直前の値を返す |
| `Atomic.compare_exchange` | `AtomicValue<'a> => ref Atomic<'a> -> 'a -> 'a -> Result<'a, 'a>` | 現在値が第2引数に等しければ第3引数を書き込んで `Ok 旧値` を返し、異なれば `Error 現在値` を返す |
| `Atomic.into_inner` | `AtomicValue<'a> => Atomic<'a> -> 'a` | セルの所有権を消費し、内部の値を取り出す |

### アトミック算術・ビット演算（整数専用）

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `Atomic.fetch_add` | `(AtomicValue<'a>, Integer<'a>) => ref Atomic<'a> -> 'a -> 'a` | 第2引数を加算して書き込み、加算前の値を返す（2 の補数ラップ） |
| `Atomic.fetch_sub` | `(AtomicValue<'a>, Integer<'a>) => ref Atomic<'a> -> 'a -> 'a` | 第2引数を減算して書き込み、減算前の値を返す（2 の補数ラップ） |
| `Atomic.fetch_and` | `(AtomicValue<'a>, Integer<'a>) => ref Atomic<'a> -> 'a -> 'a` | ビット論理積（AND）を書き込み、更新前の値を返す |
| `Atomic.fetch_or` | `(AtomicValue<'a>, Integer<'a>) => ref Atomic<'a> -> 'a -> 'a` | ビット論理和（OR）を書き込み、更新前の値を返す |
| `Atomic.fetch_xor` | `(AtomicValue<'a>, Integer<'a>) => ref Atomic<'a> -> 'a -> 'a` | ビット排他的論理和（XOR）を書き込み、更新前の値を返す |

## 関連項目

- [Mutex](./mutex.md)
- [RwMutex](./rwmutex.md)
- [Routine](./routine.md)
- [Rc と Arc](../memory/rc.md)
- [引数の順序](../conventions.md)
- [型クラスと制約](../../types/type-classes.md)
