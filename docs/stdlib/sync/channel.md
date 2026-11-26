# Channel

`Channel<'a>` は、`tzroutine` 間で所有値を安全に受け渡す双方向メッセージングチャネルです。単一種類のハンドルで送信と受信の双方を行え、`Channel.share` でハンドルを複製して各 `tzroutine` へ配布します。また、関数のインターフェースで送受信の方向を型レベルで制約するための単方向ハンドル `SendOnly<'a>` および `ReceiveOnly<'a>` も提供します。

`Channel`・`SendOnly`・`ReceiveOnly` は互いに関連するオプトイン標準モジュールであり、いずれかの名前がソースに現れた時点で一括して読み込まれます。なお、ハンドルの自動クローズ（最後の送信端の `Drop` による閉鎖）や `--wasm-feature threads` ワーカープールでの通信が必要な場合は [DataChannel](./datachannel.md) を選択します。

## 要点

- `Channel.make capacity` は容量 `capacity` のチャネルを生成する（負数はトラップ）。容量 `0` は送信側と受信側が出会うまで双方が待機する同期チャネル（ランデブー通信）であり、`1` 以上は指定件数まで滞留できる有界バッファ付き FIFO チャネルとなる。
- 要素型 `'a` は `Send` を満たし、かつ外部への借用を含まない所有値でなければならない（借用を含む要素の送信は `E1013`）。
- チャネルの閉鎖は `Channel.close`（または `SendOnly.close`）の明示的呼び出しでのみ行われ、ハンドルを `Drop` しても閉鎖されない。閉鎖済みチャネルへの `send` および二重の `close` はトラップする。
- 閉鎖されたチャネルからの `recv` は、バッファ内の残余要素をすべて取り出した後に `Maybe.None` を返し続ける。`for x in ch do ...` ループを使うと閉鎖・排出完了まで簡潔に反復受信できる。
- 待機が発生しても OS スレッド自体はブロックせず、実行中の `tzroutine` のみがスケジューラ上で待機状態に移行する。進行可能なタスクもタイマーも存在しない全停止状態はランタイムがデッドロックとして検出しトラップする。
- 複数チャネルの同時待機には [`select` 式](../../concurrency/select.md) を組み合わせて使用する。

## 基本的な使い方

生産者 `tzroutine` が値を順次送信した後に `Channel.close` で終端を通知し、受信側が `for ... in` ループで全要素を集計する典型的なパイプライン例です。

```tsuzuri run=total%3D5050
let stream: Channel<i64> = Channel.make 0
let tx = Channel.share stream
tzroutine {
    for n in 1i64 ..= 100 do
        Channel.send tx n
    Channel.close tx
}
let mut total = 0i64
for item in stream do
    total = total + item
$"total={total}"
```

- 要素型が文脈から一意に定まらない場合は `let stream: Channel<i64> = Channel.make 0` のように型注釈を添えます（未解決時は `E1015`）。
- 各操作のハンドル引数は `ref Channel<'a>` を受け取るため、呼び出し時は暗黙借用により `Channel.send tx n` とそのまま記述できます。

## バッファなし同期通信とバッファ付き通信

`Channel.make` に渡す容量によって通信の同期特性が切り替わります。

- **バッファなしチャネル（`capacity == 0`）**: `send` は対応する `recv` が到着するまで待機し、`recv` は対応する `send` が到着するまで待機します。両者が揃った時点で送信元スタックから受信先スタックへ値が直接移動するため、受け渡し自体がタスク間の同期点になります。
- **バッファ付きチャネル（`capacity >= 1`）**: 内部リングバッファに空きがある限り、`send` は受信側を待たずに即座に完了します。バッファが満杯のときの `send` と、バッファが空のときの `recv` のみが待機します。

```tsuzuri run=len%3D2%20cap%3D3%20order%3D10-20-30
let ch: Channel<i64> = Channel.make 3
Channel.send ch 10
Channel.send ch 20
let len = Channel.length ch
let cap = Channel.capacity ch
Channel.send ch 30
let a = Maybe.default_value 0 (Channel.recv ch)
let b = Maybe.default_value 0 (Channel.recv ch)
let c = Maybe.default_value 0 (Channel.recv ch)
$"len={len} cap={cap} order={a}-{b}-{c}"
```

## 閉鎖（`close`）と閉鎖検出・反復受信

チャネルの閉鎖は、これ以上データを送らないことを受信側へ伝える送信側の責務です。

```tsuzuri run=v1%3D7%20v2%3D8%20v3%3Dclosed
def format_recv :: Maybe<i64> -> string
fn format_recv item =
    match item with
    | Maybe.Some v -> $"{v}"
    | Maybe.None -> "closed"

let ch: Channel<i64> = Channel.make 2
Channel.send ch 7
Channel.send ch 8
Channel.close ch
$"v1={format_recv (Channel.recv ch)} v2={format_recv (Channel.recv ch)} v3={format_recv (Channel.recv ch)}"
```

- **残余データの保護**: `close` 時点でバッファ内に残っていた要素は破棄されず、`recv` や `for` ループで先頭から順に取り出せます。すべて排出された後の `recv` は待機せず即座に `Maybe.None` を返します。
- **不正操作のトラップ**: 閉鎖済みチャネルに対する `Channel.send`（送信待機中に別タスクが閉鎖した場合を含む）は `send on closed Channel` でトラップし、閉鎖済みチャネルに対する 2 回目の `Channel.close` は `close of closed Channel` でトラップします。
- **ハンドル破棄との独立性**: `Channel` ハンドルを `Drop` してもチャネルは閉鎖されません。すべてのハンドル（`SendOnly` / `ReceiveOnly` を含む）が `Drop` された時点で初めてチャネルブロックが解放され、未受信の残余要素があればその場で 1 回ずつ `Drop` されます。
- **`for` ループでの受信**: `for x in ch do ...` は `std::Channel.recv`（または `std::ReceiveOnly.recv`）が `Maybe.None` を返すまで反復します。途中で `break` した場合も `ch` は消費されず、後続の処理で残りの要素を引き続き受信できます。

## ノンブロッキング送受信（`try_send` / `try_recv`）

待機せずに即座に成否を判定したい場合は `Channel.try_send` と `Channel.try_recv` を使用します。`try_send` は失敗時にも渡した要素を `Channel.SendError` に包んで呼び出し元へ返却するため、所有値が失われることはありません。また、閉鎖済みチャネルに対して `try_send` を呼んでもトラップせず `Result.Error (Channel.Closed item)` が返ります。

```tsuzuri run=full%3Dextra%20closed%3Dlate%20recv%3Ddisconnected
let ch: Channel<string> = Channel.make 1
let _ok = Channel.try_send ch "first"
let full =
    match Channel.try_send ch "extra" with
    | Result.Error (Channel.Full item) -> item
    | _ -> "unexpected"
let _drained = Channel.try_recv ch
Channel.close ch
let closed =
    match Channel.try_send ch "late" with
    | Result.Error (Channel.Closed item) -> item
    | _ -> "unexpected"
let state =
    match Channel.try_recv ch with
    | Channel.Item _ -> "item"
    | Channel.Empty -> "empty"
    | Channel.Disconnected -> "disconnected"
$"full={full} closed={closed} recv={state}"
```

## 単方向チャネル（`SendOnly` / `ReceiveOnly`）

`Channel.send_only` は送信と閉鎖のみを許可する `SendOnly<'a>` を、`Channel.receive_only` は受信のみを許可する `ReceiveOnly<'a>` を生成します。どちらも内部的には `Channel.share` と同じく参照カウントを 1 増やす軽量なハンドル生成であり、元の双方向 `Channel<'a>` へ逆変換する手段は存在しません。これにより「受信側が誤ってチャネルを閉じる」「送信側が自分の出力を読み取る」といった設計ミスを型検査で防げます。

```tsuzuri run=sum%3D55
def producer :: own SendOnly<i64> -> i64 -> unit
fn producer out limit =
    for i in 1i64 ..= limit do
        SendOnly.send out i
    SendOnly.close out

def consumer :: ref ReceiveOnly<i64> -> i64
fn consumer input =
    let mut acc = 0i64
    for v in input do
        acc = acc + v
    acc

let raw: Channel<i64> = Channel.make 2
let tx = Channel.send_only raw
let rx = Channel.receive_only raw
tzroutine {
    producer tx 10
}
$"sum={consumer (ref rx)}"
```

## `select` 式との連携

複数のチャネルに対する送受信やキャンセル待機を多重化する場合は [`select` 式](../../concurrency/select.md) を用います。`select` の `recv` アームには `Channel<'a>` と `ReceiveOnly<'a>`、`send` アームには `Channel<'a>` と `SendOnly<'a>` を指定できます。閉鎖されて空になったチャネルは `recv` アームで即座に選択可能となり、`Maybe.None` を受け取るため、`when` ガードと組み合わせることで複数入力ストリームの完了待ちを簡潔に記述できます。

```tsuzuri run=merged%3D36
let left: Channel<i64> = Channel.make 0
let right: Channel<i64> = Channel.make 0
let l_tx = Channel.send_only left
let r_tx = Channel.send_only right
let l_rx = Channel.receive_only left
let r_rx = Channel.receive_only right

tzroutine {
    for i in 1i64 ..= 4 do SendOnly.send l_tx i
    SendOnly.close l_tx
}
tzroutine {
    for i in 5i64 ..= 8 do SendOnly.send r_tx i
    SendOnly.close r_tx
}

let mut l_open = true
let mut r_open = true
let mut sum = 0i64
while l_open || r_open do
    select
    | recv item from l_rx when l_open ->
        match item with
        | Maybe.Some v -> sum = sum + v
        | Maybe.None -> l_open = false
    | recv item from r_rx when r_open ->
        match item with
        | Maybe.Some v -> sum = sum + v
        | Maybe.None -> r_open = false
$"merged={sum}"
```

## 所有権・借用・ターゲット制約

- **ハンドルの所有権**: `Channel<'a>`・`SendOnly<'a>`・`ReceiveOnly<'a>` はいずれも非 `Copy` の不透明所有型（フィールド参照や直接構築は `E1022`）であり、`Send` かつ `Sync` を満たします。`Drop` を持つため再利用可能な通常の関数値には捕捉できませんが（`E1005`）、`share` したハンドルを `tzroutine` や `Owned.function` へムーブできます。
- **要素の借用禁止**: 送信された要素は呼び出し元のスコープを抜けた後に別タスクで受信されるため、参照や借用環境を持つクロージャを送信することは `E1013` で拒否されます。また、トレイトオブジェクトを送る場合は `dyn (Display, Send)` のように `+ Send` 境界が必要です。要素型が借用を含みうる関数型などの場合、`Channel.send` / `try_send` の部分適用や関数値化も `E1013` となります。
- **旧 API からの移行診断**: 以前の `Channel.bounded`・`Channel.clone_sender`・`Channel.Sender`・`Channel.Receiver` は `DataChannel` モジュールへ改名されており、使用時は `E1040` とともに `tsuzuri fix` による自動書き換え候補が提示されます。
- **対応ターゲット**:
  - ネイティブ 5 環境（Windows x64/Arm64、Linux x64/Arm64、macOS Arm64）: 完全対応。`Mutex.with_lock` 保持中のチャネル待機も可能。
  - WebAssembly（`wasm32` + `--wasm-feature jspi`）: 完全対応（待機中の `tzroutine` のみを JSPI で中断）。
  - 既定の単一スレッド WebAssembly: `tzroutine` を起動しない単一フロー内でのバッファ付き送受信は動作し、ブロックが必要な待機は即座にトラップ。
  - `--wasm-feature threads` / `--freestanding` / `--trap-mode return`: 非対応（`E2000`）。`--wasm-feature threads` や `--trap-mode return` では [DataChannel](./datachannel.md) を使用します。

## 引数の順序

`Channel`・`SendOnly`・`ReceiveOnly` はリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、操作対象のチャネルハンドルを**第1引数**に取ります（`Channel.send ch value`、`SendOnly.try_send tx value`）。これは状態を持つ通信端点に対するメソッドレシーバと揃えるためであり、標準ライブラリ全体の規則は [引数の順序](../conventions.md) に定義されています。

## API リファレンス

### 型定義

| 型 | 定義 / 説明 |
| --- | --- |
| `Channel<'a>` | 双方向チャネルハンドル（不透明型、`Drop` で参照カウント減算） |
| `SendOnly<'a>` | 送信専用チャネルハンドル（`Channel.send_only` で生成） |
| `ReceiveOnly<'a>` | 受信専用チャネルハンドル（`Channel.receive_only` で生成） |
| `Channel.SendError<'a>` | `Full of 'a \| Closed of 'a`（`try_send` 失敗時に未送信要素を保持して返却） |
| `Channel.Received<'a>` | `Item of 'a \| Empty \| Disconnected`（`try_recv` の結果） |

### `Channel` モジュール（全 11 関数）

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `Channel.make` | `Send<'a> => i64 -> Channel<'a>` | 容量を指定してチャネルを生成する（`0` は同期通信、負数はトラップ） |
| `Channel.send` | `ref Channel<'a> -> 'a -> unit` | 要素を送信する（満杯時は待機、閉鎖済みならトラップ） |
| `Channel.recv` | `ref Channel<'a> -> Maybe<'a>` | 要素を受信する（空なら待機、閉鎖かつ排出済みなら `None`） |
| `Channel.try_send` | `ref Channel<'a> -> 'a -> Result<unit, Channel.SendError<'a>>` | 待機せず送信を試み、満杯なら `Full`、閉鎖済みなら `Closed` で要素を返す |
| `Channel.try_recv` | `ref Channel<'a> -> Channel.Received<'a>` | 待機せず受信を試み、`Item`・`Empty`・`Disconnected` のいずれかを返す |
| `Channel.close` | `ref Channel<'a> -> unit` | チャネルを閉鎖する（二重閉鎖はトラップ） |
| `Channel.length` | `ref Channel<'a> -> i64` | 現在バッファに滞留している要素数を返す |
| `Channel.capacity` | `ref Channel<'a> -> i64` | チャネルのバッファ容量を返す |
| `Channel.share` | `ref Channel<'a> -> Channel<'a>` | 同じチャネルを指す新しい双方向ハンドルを生成する |
| `Channel.send_only` | `ref Channel<'a> -> SendOnly<'a>` | 同じチャネルを指す送信専用ハンドルを生成する |
| `Channel.receive_only` | `ref Channel<'a> -> ReceiveOnly<'a>` | 同じチャネルを指す受信専用ハンドルを生成する |

### `SendOnly` モジュール（全 6 関数）

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `SendOnly.send` | `ref SendOnly<'a> -> 'a -> unit` | 要素を送信する（閉鎖済みならトラップ） |
| `SendOnly.try_send` | `ref SendOnly<'a> -> 'a -> Result<unit, Channel.SendError<'a>>` | 待機せず送信を試みる |
| `SendOnly.close` | `ref SendOnly<'a> -> unit` | チャネルを閉鎖する（二重閉鎖はトラップ） |
| `SendOnly.length` | `ref SendOnly<'a> -> i64` | バッファ内の現在要素数を返す |
| `SendOnly.capacity` | `ref SendOnly<'a> -> i64` | チャネルのバッファ容量を返す |
| `SendOnly.share` | `ref SendOnly<'a> -> SendOnly<'a>` | 送信専用ハンドルを複製する |

### `ReceiveOnly` モジュール（全 5 関数）

| 関数 | 型シグネチャ | 説明 |
| --- | --- | --- |
| `ReceiveOnly.recv` | `ref ReceiveOnly<'a> -> Maybe<'a>` | 要素を受信する（閉鎖かつ排出済みなら `None`） |
| `ReceiveOnly.try_recv` | `ref ReceiveOnly<'a> -> Channel.Received<'a>` | 待機せず受信を試みる |
| `ReceiveOnly.length` | `ref ReceiveOnly<'a> -> i64` | バッファ内の現在要素数を返す |
| `ReceiveOnly.capacity` | `ref ReceiveOnly<'a> -> i64` | チャネルのバッファ容量を返す |
| `ReceiveOnly.share` | `ref ReceiveOnly<'a> -> ReceiveOnly<'a>` | 受信専用ハンドルを複製する |

## 関連項目

- [DataChannel](./datachannel.md)
- [Routine](./routine.md)
- [Context](./context.md)
- [Timer と Ticker](./timer.md)
- [引数の順序](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
- [select 式](../../concurrency/select.md)
- [ループ構文](../../expressions/loops.md)
