# DataChannel

`DataChannel` は、送信端 `DataChannel.Sender<'a>` と受信端 `DataChannel.Receiver<'a>` が明確に分離された有界 MPMC（複数生産者・複数消費者）データチャネルです。`tzroutine` 間での通信に加え、OS スレッドや `Parallel`、WebAssembly の `--wasm-feature threads` ワーカープール、さらには `--trap-mode return` 境界内でも一貫して動作します。

`DataChannel` は名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールです。

## 要点

- `DataChannel.bounded capacity` は容量 `1` 以上のリングバッファを確保し、`(Sender<'a> * Receiver<'a>)` のペアを返す（`capacity <= 0` はトラップ）。要素型 `'a` には `Send` 制約が課される。
- 明示的な `close` 関数は持たず、**すべての `Sender` が `Drop` された時点で自動的に閉鎖**される（RAII 方式）。閉鎖後はバッファ内の残余要素を取り出し終えると `recv` が `Maybe.None` を返す。
- すべての `Receiver` が先に `Drop` された場合、以降の `DataChannel.send` はトラップせず、送信しようとした要素を `Result.Error item` に包んで呼び出し元へ返却する。
- `Sender` と `Receiver` はどちらも `Send` かつ `Sync` を満たすため、`DataChannel.clone_sender` で送信端を増やすほか、`Routine.scope` や `Arc<DataChannel.Receiver<'a>>` で複数ワーカーから安全に共有できる。

## `Channel` と `DataChannel` の違い

Tsuzuri は用途の異なる 2 種類のチャネルを提供しています。

| 比較項目 | `DataChannel` | [`Channel`](./channel.md) |
| --- | --- | --- |
| ハンドル構成 | `Sender<'a>` と `Receiver<'a>` に分離 | 双方向 `Channel<'a>`（＋`SendOnly` / `ReceiveOnly`） |
| 容量の範囲 | `1` 以上（有界バッファ必須） | `0`（同期ランデブー）以上 |
| 閉鎖の契機 | 最後の `Sender` の `Drop` で自動閉鎖 | `Channel.close` の明示的呼び出しのみ |
| 閉鎖・切断後の `send` | `Result.Error item` で要素を返却（トラップしない） | トラップ（`try_send` は `Error` 返却） |
| `select` 式・`for` 反復 | 非対応（`while` + `match` で受信） | 対応 |
| `--wasm-feature threads` | 対応（WASM アトミック＋ワーカープール） | 非対応（`E2000`） |
| `--trap-mode return` | 対応（境界脱出時に自動解放） | 非対応（`E2000`） |

`select` による多重待機や容量 `0` の同期通信には `Channel` を使い、送信タスクのスコープ終了と同時に自動でストリームを閉じたい場合や WebAssembly スレッドバックエンドで動かす場合には `DataChannel` を使います。

## 基本的な使い方とライフサイクル

送信端を生産者 `tzroutine` へムーブすると、生産者の処理が終わってスコープを抜けた瞬間に `Sender` が `Drop` され、受信側のループが自然に終了します。

```tsuzuri run=sum%3D210
def produce :: own DataChannel.Sender<i64> -> i64 -> unit
fn produce tx count =
    for i in 1i64 ..= count do
        let _res = DataChannel.send (ref tx) i

def consume_all :: ref DataChannel.Receiver<i64> -> i64
fn consume_all rx =
    let mut acc = 0i64
    let mut active = true
    while active do
        match DataChannel.recv rx with
        | Maybe.Some v -> acc = acc + v
        | Maybe.None -> active = false
    acc

match DataChannel.bounded 4 with
| (tx, rx) ->
    tzroutine {
        produce tx 20
    }
    $"sum={consume_all (ref rx)}"
```

### 複数送信者（`clone_sender`）と受信端切断時の要素回収

複数の生産者を使う場合は `DataChannel.clone_sender` で独立した `Sender` を複製します。元の `Sender` を `Drop` しても複製された `Sender` が残っている間はチャネルは開いたまま維持されます。逆に受信側の `Receiver` が先に破棄された場合、`DataChannel.send` は待機せず `Result.Error` で要素を返します。

```tsuzuri run=received%3D30%20returned%3D99
match DataChannel.bounded 2 with
| (tx1, rx) ->
    let tx2 = DataChannel.clone_sender (ref tx1)
    let _a = DataChannel.send (ref tx1) 10
    Owned.drop tx1
    let _b = DataChannel.send (ref tx2) 20
    let first = Maybe.default_value 0 (DataChannel.recv (ref rx))
    let second = Maybe.default_value 0 (DataChannel.recv (ref rx))
    Owned.drop rx
    let returned =
        match DataChannel.send (ref tx2) 99 with
        | Result.Ok _ -> 0
        | Result.Error item -> item
    $"received={first + second} returned={returned}"
```

### 複数ワーカーによるジョブキュー（MPMC）

`DataChannel.Receiver<'a>` は `Sync` を満たすため、`Arc` に包んで複数のワーカー `tzroutine` で共有できます。各要素は待機中のいずれか 1 つのワーカーにのみ配送されます。

```tsuzuri run=processed%3D12%20total%3D650
def worker_loop :: ref DataChannel.Receiver<i64> -> ref Atomic<i64> -> ref Atomic<i64> -> unit
fn worker_loop rx count_acc sum_acc =
    let mut open = true
    while open do
        match DataChannel.recv rx with
        | Maybe.Some x ->
            let _c = Atomic.fetch_add count_acc 1
            let _s = Atomic.fetch_add sum_acc (x * x)
        | Maybe.None -> open = false

match DataChannel.bounded 3 with
| (tx, rx) ->
    let shared_rx = Arc.new rx
    let count_acc = Arc.new (Atomic.create 0i64)
    let sum_acc = Arc.new (Atomic.create 0i64)
    let wg = WaitGroup.create ()
    tzroutine {
        for n in 1i64 ..= 12 do
            let _sent = DataChannel.send (ref tx) n
    }
    for _w in 0 ..< 3 do
        let rx_w = Arc.share (ref shared_rx)
        let c_w = Arc.share (ref count_acc)
        let s_w = Arc.share (ref sum_acc)
        WaitGroup.go (ref wg) (Owned.function (\() ->
            worker_loop (Arc.get (ref rx_w)) (Arc.get (ref c_w)) (Arc.get (ref s_w))))
    WaitGroup.wait (ref wg)
    $"processed={Atomic.load (Arc.get (ref count_acc))} total={Atomic.load (Arc.get (ref sum_acc))}"
```

## 待機規則・ロックとの相互作用・ターゲット動作

- **スケジューラ上の待機とデッドロック検出**: ネイティブターゲットおよび `--wasm-feature jspi` の `wasm32` では、バッファ満杯時の `send` と空時の `recv` は呼び出した `tzroutine` のみを待機させ、OS スレッドは他の `tzroutine` を継続実行します。すべてのタスクが待機し起床要因が存在しない場合（`Sender` を握ったまま `recv` でブロックした場合など）は、デッドロックとして検出しトラップします。
- **`--wasm-feature threads` での協調処理**: WebAssembly スレッドバックエンドでは、待機に入るワーカーは未着手の `Parallel.*` チャンクがあれば自スタック上で最大深さ 16 までワークヘルピングを行った上でスリープします。
- **`Mutex.with_lock` 内での利用**: ネイティブターゲットおよび `tzroutine` ランタイムを使用する WebAssembly プログラムでは、ロックを保持したまま `DataChannel.send` / `recv` で待機できます（ただし待機中は他のロック要求タスクもブロックするため、原則としてロック外での送受信を推奨します）。`tzroutine` ランタイムを使用しない WebAssembly プログラムでは、デッドロック防止のため `Mutex.with_lock` 内での `DataChannel` 操作はトラップします。
- **要素の借用禁止**: [`Channel`](./channel.md) と同様、送信する要素は借用や借用環境付きクロージャを含んではなりません（`E1013`）。要素が関数型を含みうる場合は `DataChannel.send` を全引数に直接適用する必要があります。

## 引数の順序

`DataChannel` モジュールはリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、`DataChannel.send`・`recv`・`clone_sender` はいずれも操作対象の端点ハンドル（`ref Sender<'a>` または `ref Receiver<'a>`）を**第1引数**に取ります。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `DataChannel.Sender<'a>` | 型（不透明ハンドル、`Send`, `Sync`, `Drop`） | 有界データチャネルの送信端。最後の `Sender` の破棄でチャネルを閉じる |
| `DataChannel.Receiver<'a>` | 型（不透明ハンドル、`Send`, `Sync`, `Drop`） | 有界データチャネルの受信端。破棄後は送信側へ `Result.Error` を返す |
| `DataChannel.bounded` | `Send<'a> => i64 -> (DataChannel.Sender<'a> * DataChannel.Receiver<'a>)` | 容量 `1` 以上の有界チャネルを生成し、送受信端の組を返す（`0` 以下はトラップ） |
| `DataChannel.send` | `ref DataChannel.Sender<'a> -> 'a -> Result<unit, 'a>` | 要素を送信する（満杯時は待機、受信端が全滅していれば `Error` で要素を返却） |
| `DataChannel.recv` | `ref DataChannel.Receiver<'a> -> Maybe<'a>` | 要素を受信する（空なら待機、全送信端が破棄され排出済みなら `None`） |
| `DataChannel.clone_sender` | `ref DataChannel.Sender<'a> -> DataChannel.Sender<'a>` | 同じチャネルに対する独立した送信端ハンドルを複製する |

## 関連項目

- [Channel](./channel.md)
- [Routine](./routine.md)
- [Parallel](./parallel.md)
- [WaitGroup](./waitgroup.md)
- [Mutex](./mutex.md)
- [引数の順序](../conventions.md)
- [WebAssembly 出力](../../compiler/webassembly.md)
