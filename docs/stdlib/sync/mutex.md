# Mutex

`Mutex<'a>` は、保護対象の値 `'a` を内部に一体保持し、一度に 1 つの `tzroutine`（または OS スレッド）のみが `Mutex.with_lock` のコールバック内で排他借用 `ref mut 'a` を通じて読み書きできるようにする排他ロック（相互排他ロック）です。

ロックと保護データを分離しない設計のため、ロックを取得せずに誤ってデータへ触れることや、アンロックし忘れることが構文上発生しません。複数のフィールドにまたがる不変条件の維持や、文字列・配列・`Vec`・`HashMap` など [Atomic](./atomic.md) で扱えない型の並行共有に使用します。`Mutex` はオプトイン標準モジュールです。

## 要点

- `Mutex.create value` で保護対象の値（`Send<'a>` が必須）を格納したロックを生成し、共有借用 `ref Mutex<'a>` に対する `Mutex.with_lock` のコールバック内でのみ `ref mut 'a` へアクセスする。コールバックの終了とともにロックは確実に解放される。
- コールバックの戻り値 `'b` は `Send` を満たし、かつ保護対象の値への借用（借用を捕捉したクロージャを含む）をロック外へ持ち出してはならない（違反時は `E1013`）。
- ネイティブ環境および `tzroutine` ランタイムを使用する WebAssembly 環境では、同一 `Mutex` の再入ロックはトラップするが、異なる `Mutex` 同士の入れ子ロックやロック保持中のチャネル待機が可能である。
- `Mutex<'a>` は `'a: Send` のもとで `Send` かつ `Sync` を満たす非 `Copy` 所有型であり、複数タスク間では [`Routine.scope`](./routine.md) の共有借用または [`Arc<Mutex<'a>>`](../memory/rc.md) で共有する（通常の関数値への直接捕捉は `E1005`）。
- ロックのポイズニング機構はなく、トラップ隔離領域（`Domain.run` や `--trap-mode return`）でトラップが発生した際も保持中のロックは境界脱出時に自動解放される。

## 基本的な使い方：スコープ安全な状態保護

複数の値を一貫して更新する必要がある場合は、個別の `Atomic` に分けるのではなく 1 つのレコードにまとめて単一の `Mutex` で保護します。これにより更新途中の不整合な状態が他タスクから観測されることを防げます。

```tsuzuri run=count%3D50%20sum%3D1275
record Ledger {
    count: i64,
    sum: i64,
}

let ledger = Mutex.create (Ledger { count: 0, sum: 0 })
let _done = Routine.scope (ref ledger) 50 (\lock idx ->
    Mutex.with_lock lock (\state -> {
        let cur = deref state;
        deref state = Ledger { count: cur.count + 1, sum: cur.sum + idx + 1 }
    }))
let result = Mutex.into_inner ledger
$"count={result.count} sum={result.sum}"
```

単独所有の `Mutex<'a>` から保護値を取り出すには `Mutex.into_inner` を使用します。

### `Arc<Mutex<'a>>` によるタスク間共有

`tzroutine { ... }` や `WaitGroup.go` のように呼び出し元スコープから独立して走るタスク間で状態を共有する場合は、`Arc.new (Mutex.create ...)` で包み、`Arc.share` で配布します。

```tsuzuri run=sum%3D21%20owners%3D1
let shared_slots = Arc.new (Mutex.create [0, 0, 0, 0, 0, 0])
let wg = WaitGroup.create ()
for step in 0 ..< 6 do
    let mine = Arc.share (ref shared_slots)
    let pos = step as i64
    WaitGroup.go (ref wg) (Owned.function (\() ->
        Mutex.with_lock (Arc.get (ref mine)) (\arr -> Array.write pos (pos + 1) arr)))
WaitGroup.wait (ref wg)
let sum = Mutex.with_lock (Arc.get (ref shared_slots)) (\arr -> Array.sum arr)
$"sum={sum} owners={Arc.strong_count (ref shared_slots)}"
```

なお、`Arc` と `Mutex` を組み合わせるとノード間の相互強参照を作ることができますが、循環したブロックは解放されないため、親子関係の一方には必ず `Arc.Weak` を使用してください（[Rc と Arc](../memory/rc.md) 参照）。

## コールバック結果と借用持ち出しの禁止

`Mutex.with_lock` のコールバックが終了すると直ちにロックが解放され、別のタスクが内部データを書き換えたり解放したりできる状態になります。そのため、ロック内部の値に対する参照 `ref` や、その参照を環境に捕捉した関数値をコールバックの戻り値にしたり、外部の別の `Mutex`・配列などへ書き出して延命させたりすることはすべて `E1013` で静的に阻止されます。

値をコピーして捕捉したクロージャや、独立した所有値を返すことは安全に許可されます。

```tsuzuri run=projected%3D105
let base = Mutex.create 100i64
let add_snapshot = Mutex.with_lock (ref base) (\v -> {
    let snapshot = deref v;
    \delta -> snapshot + delta
})
$"projected={add_snapshot 5}"
```

戻り値の型が関数型など借用を保持しうる型である場合、コンパイラが安全性を検証できるよう `Mutex.with_lock` はロックとコールバックの 2 引数をその場で直接適用して呼び出す必要があります（部分適用や関数値化は `E1013`）。戻り値が整数や `string` のように借用を含みえない型であれば部分適用も可能です。

## ロック獲得規則とターゲット別の挙動

### ネイティブおよび `tzroutine` ランタイム有効時

- **非再入性（自己デッドロック防止）**: ロックは獲得した `tzroutine`（またはトップレベルスレッド）に紐づきます。すでに保持している同一の `Mutex` に対して同じタスクが再度 `Mutex.with_lock` を呼ぶと、`Mutex.with_lock cannot be nested` で即座にトラップします。
- **異なるロックの入れ子と待機**: **別々の** `Mutex` インスタンスであれば入れ子で獲得できます（複数ロックを取る際はデッドロックを避けるため獲得順序を統一してください）。またロック保持中に `Channel`・`DataChannel`・`Time.sleep`・`Routine.yield`・`Parallel.*` などで待機することも可能ですが、待機中は同ロックを待つ他タスクも停止するため、I/O や重い計算はロック外で行うのが原則です。
- **スケジューラ連携**: ロック競合時は短時間のスピン試行ののち、OS スレッドをブロックせず待機中の `tzroutine` のみをランタイムの待機テーブルへスリープさせます（ロック獲得順序の厳密な FIFO 公平性は保証しません）。

### WebAssembly ターゲット

- `Channel`・`select`・タイマー・他の同期プリミティブ、または `--wasm-feature jspi` を使用するプログラムでは上記ネイティブと同一の `tzroutine` ロック規則が適用されます。
- `tzroutine` ランタイムを使用しない WebAssembly プログラム（既定の単一スレッド構成や `--wasm-feature threads` のデータ並列構成）では、デッドロックを構造的に排除するため、`Mutex.with_lock` の保持中に「同一または別の `Mutex.with_lock`」「`Parallel.*`」「`DataChannel` 送受信」を呼び出すといずれもトラップします。

### トラップ時の自動解放

Tsuzuri の `Mutex` にはロックのポイズン状態はありません。既定の `--trap-mode abort` ではトラップでプロセス全体が終了します。[`Domain.run`](../core/domain.md) のトラップ隔離領域内や `--trap-mode return` のエクスポート境界内でトラップが発生した場合、ランタイムはその境界内で獲得されたロックを脱出時に自動的に解放します。

## 引数の順序

`Mutex` モジュールはリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、`Mutex.with_lock` は操作対象のロック `ref Mutex<'a>` を**第1引数**、コールバック関数 `(ref mut 'a -> 'b)` を第2引数に取ります。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

`Mutex` モジュールの全 3 公開関数の一覧です。

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `Mutex<'a>` | 型（不透明レコード、非 `Copy`, `Send`, `Sync`） | 排他ロックと保護値 `'a` を一体保持する同期コンテナ |
| `Mutex.create` | `Send<'a> => 'a -> Mutex<'a>` | 初期値を格納した未ロック状態の `Mutex<'a>` を生成する |
| `Mutex.with_lock` | `Send<'b> => ref Mutex<'a> -> (ref mut 'a -> 'b) -> 'b` | 排他ロックを獲得してコールバックに `ref mut 'a` を渡し、完了後にロックを解放して結果を返す |
| `Mutex.into_inner` | `Mutex<'a> -> 'a` | `Mutex` の所有権を消費し、内部の所有値 `'a` をロックなしで取り出す |

## 関連項目

- [RwMutex](./rwmutex.md)
- [Cond](./cond.md)
- [Atomic](./atomic.md)
- [SyncMap](./syncmap.md)
- [Routine](./routine.md)
- [Rc と Arc](../memory/rc.md)
- [Domain](../core/domain.md)
- [引数の順序](../conventions.md)
- [WebAssembly 出力](../../compiler/webassembly.md)
