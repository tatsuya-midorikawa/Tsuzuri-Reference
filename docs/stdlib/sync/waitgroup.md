# WaitGroup

`WaitGroup` は、動的に起動した複数の `tzroutine` 群がすべて完了するまで待機するための同期カウンタ（待機カウンタ）です。タスクの起動前に未完了カウントを加算し、各タスクの終了時に減算することで、カウンタが `0` に戻るまで呼び出し元の `tzroutine` をブロックせずに待機させます。

`WaitGroup` は名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールです。

## 要点

- `WaitGroup.create ()` で初期カウント `0` のハンドルを生成し、`WaitGroup.share` で複製して各ワーカーへ受け渡す（最後のハンドルの `Drop` で解放）。
- **推奨パターン（`WaitGroup.go`）**: `WaitGroup.go group f` を使うと、「カウントの `+1` 加算・新しい `tzroutine` の起動・完了時の `-1` 減算」が一体で実行されるため、`add` と `done` の不整合が原理的に発生しない。
- **手動カウント管理（`add` / `done`）**: `tzroutine { ... }` ブロックでムーブ捕捉を行いたい場合は、必ず **`tzroutine` を起動する前（呼び出し元タスク上）** に `WaitGroup.add group 1` を呼び、タスク末尾で `WaitGroup.done` を呼ぶ。
- カウンタが負になった場合は `negative WaitGroup counter` で即座にトラップする。
- `WaitGroup.wait` は呼び出した `tzroutine` のみをスケジューラ上でスリープさせ、OS スレッド自体はブロックしない。

## 基本的な使い方

### `WaitGroup.go` による安全なタスク起動

所有クロージャ [`Owned.Function<unit, unit>`](../memory/owned.md) を渡せる処理では、`WaitGroup.go` が最も簡潔かつ安全です。`WaitGroup.go` 自身は完了を待たないため、全タスクを登録した後に呼び出し元で `WaitGroup.wait` を呼びます。

```tsuzuri run=sum%3D5050
let wg = WaitGroup.create ()
let acc = Arc.new (Atomic.create 0i64)

for n in 1i64 ..= 100 do
    let shared_acc = Arc.share (ref acc)
    WaitGroup.go (ref wg) (Owned.function (\() -> {
        let _old = Atomic.fetch_add (Arc.get (ref shared_acc)) n;
        ()
    }))

WaitGroup.wait (ref wg)
$"sum={Atomic.load (Arc.get (ref acc))}"
```

### `add`・`share`・`done` による手動管理

`Owned.function` では捕捉値をムーブ消費できないため、送信端 `DataChannel.Sender` などの所有値をタスク内でムーブ消費したい場合は、`WaitGroup.add` で事前にカウントを増やし、`WaitGroup.share` で複製したハンドルを `tzroutine { ... }` へ持ち込んで末尾で `WaitGroup.done` を呼びます。

```tsuzuri run=total%3D60
let wg = WaitGroup.create ()
let ch: Channel<i64> = Channel.make 3

for i in 1i64 ..= 3 do
    WaitGroup.add (ref wg) 1
    let worker_wg = WaitGroup.share (ref wg)
    let tx = Channel.share ch
    tzroutine {
        Channel.send tx (i * 10)
        WaitGroup.done (ref worker_wg)
    }

WaitGroup.wait (ref wg)
Channel.close ch

let mut total = 0i64
for v in ch do
    total = total + v
$"total={total}"
```

## 他のタスク待機手段との使い分け

| 手段 | 特徴と適した場面 |
| --- | --- |
| `WaitGroup` | 動的な個数のタスク起動や、条件分岐・ループに応じた柔軟な完了待機（戻り値はチャネルや `Atomic` / `Mutex` で収集） |
| [`Routine.scope`](./routine.md) | 固定 `count` 個の子タスクへスタック上の共有借用 `ref 's` をコピーなしで貸し出し、結果配列 `['a]` を直接受け取る場合 |
| [`ErrGroup`](./errgroup.md) | 各タスクが `Result<unit, 'e>` を返し、最初のエラー発生時にキャンセル伝播と同時実行数制限（`set_limit`）を行いたい場合 |

## カウンタ規則とターゲット動作

- **起動前の `add` 厳守**: `tzroutine { WaitGroup.add ... }` のように子タスクの内部で `add` を呼ぶと、子タスクが走り始める前に親タスクの `WaitGroup.wait` がカウント `0` を見て素通りしてしまう競合が生じます。`add` は常に親タスク側でタスク起動前に実行してください。
- **カウンタの再利用規則**: カウンタが `0` の状態から `add` で正の値にする操作は、前回の `WaitGroup.wait` が完全に復帰した後に行う必要があります（待機中の `wait` が戻る前に `0` から再加算する使い方は未保証です）。
- **負カウントのトラップ**: `WaitGroup.done`（内部実装は `WaitGroup.add group (-1)`）の過剰呼び出し等でカウンタが `0` 未満になると即座にトラップします。
- **ハンドルの所有権**: `WaitGroup` は非 `Copy` の不透明ハンドル（直接構築・分解は `E1022`）であり、`Send` かつ `Sync` を満たします。再利用可能な通常の関数値には捕捉できません（`E1005`）。
- **対応ターゲット**: ネイティブ 5 環境、および `--wasm-feature jspi` を指定した `wasm32` で完全動作します。既定の単一スレッド WebAssembly では、`WaitGroup.go` を使用すると `tzroutine` 起動を伴うため `E2000` となります（`go` を使わない単一フローでは、未完了カウントが残った状態で `wait` した時点でトラップします）。

## 引数の順序

`WaitGroup` モジュールはリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、`add`・`done`・`wait`・`go`・`share` のすべてで操作対象のハンドル `ref WaitGroup` を**第1引数**に取ります（`WaitGroup.add group delta`、`WaitGroup.go group f`）。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

`WaitGroup` モジュールの全 6 公開関数（標準ライブラリ定義関数 1 個＋コンパイラ組み込み関数 5 個）の一覧です。

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `WaitGroup` | 型（不透明ハンドル、非 `Copy`, `Send`, `Sync`, `Drop`） | 参照カウント管理されるタスク完了待機カウンタ |
| `WaitGroup.create` | `unit -> WaitGroup` | カウント `0` の新しい `WaitGroup` を生成する（組み込み） |
| `WaitGroup.add` | `ref WaitGroup -> i64 -> unit` | カウンタに指定値を加算する。結果が負になるとトラップする（組み込み） |
| `WaitGroup.done` | `ref WaitGroup -> unit` | カウンタから `1` を減算する（`WaitGroup.add group (-1)` と等価） |
| `WaitGroup.wait` | `ref WaitGroup -> unit` | カウンタが `0` になるまで呼び出しタスクを待機させる（組み込み） |
| `WaitGroup.go` | `ref WaitGroup -> Owned.Function<unit, unit> -> unit` | カウンタに `1` を加算して新しい `tzroutine` で関数を実行し、終了時に `1` を減算する（組み込み） |
| `WaitGroup.share` | `ref WaitGroup -> WaitGroup` | 同じカウンタを指す新しい所有ハンドルを生成する（組み込み） |

## 関連項目

- [ErrGroup](./errgroup.md)
- [Routine](./routine.md)
- [Owned](../memory/owned.md)
- [Channel](./channel.md)
- [引数の順序](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
