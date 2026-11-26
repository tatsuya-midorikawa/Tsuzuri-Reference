# ErrGroup

`ErrGroup<'e>` は、1 つの論理的な処理を複数のサブタスク（`tzroutine`）に分割して並行実行し、エラー伝播・キャンセル連携・同時実行数制限を一括管理するエラー伝播タスクグループです。

いずれかのタスクが `Result.Error` を返した時点でグループに紐づく [`Context`](./context.md) が自動的にキャンセルされるため、残りのタスクはそれを検知して不要な処理を早期中断できます。`ErrGroup` はオプトイン標準モジュールです。

## 要点

- `ErrGroup.create ()`（または親コンテキストを指定する `ErrGroup.with_context`）でグループを生成し、`ErrGroup.go` で `Result<unit, 'e>` を返す所有クロージャを起動する（エラー型 `'e` は `Send` が必須）。
- `ErrGroup.wait` は起動された**すべてのタスクが終了するまで待機**し、グループコンテキストをキャンセルした上で、**時間的に最初に発生したエラー**を `Result.Error` で返す（全タスクが `Ok` なら `Result.Ok ()`）。2 件目以降のエラーは破棄される。
- `ErrGroup.set_limit n` により、同時に実行中となるタスク数の上限を `n` に制限できる（負数を指定すると無制限に戻る）。
- 上限到達時に待機せず即座に呼び出し元へクロージャを返却するノンブロッキング起動 `ErrGroup.try_go` も提供される。

## 基本的な使い方：最初のエラーによる協調的中断

1 つのサブタスクがエラーを返した際、`ErrGroup.context` から取得したコンテキストの `done` チャネルが閉鎖され、他の待機中タスクが速やかに終了する例です。

```tsuzuri run=outcome%3DError%204%20aborted%3D7
let group: ErrGroup<i64> = ErrGroup.create ()
let aborted = Arc.new (Atomic.create 0i64)

for id in 1i64 ..= 8 do
    let ctx = ErrGroup.context (ref group)
    let counter = Arc.share (ref aborted)
    ErrGroup.go (ref group) (Owned.function (\() ->
        if id == 4 then Result.Error id
        else {
            let done = Context.done (ref ctx);
            let _closed = Channel.recv done;
            let _old = Atomic.fetch_add (Arc.get (ref counter)) 1;
            Result.Ok ()
        }))

let outcome =
    match ErrGroup.wait (ref group) with
    | Result.Ok _ -> "Ok"
    | Result.Error code -> $"Error {code}"
$"outcome={outcome} aborted={Atomic.load (Arc.get (ref aborted))}"
```

外部のタイムアウトや上位リクエストのキャンセルと連動させたい場合は、`ErrGroup.with_context (ref parent_ctx)` でグループを作成します。親コンテキストがキャンセルされると `ErrGroup.context` も連鎖してキャンセルされます（逆にグループ内のエラーは親コンテキストをキャンセルしません）。

## 同時実行数の制限（`set_limit` / `try_go`）

`ErrGroup.set_limit` を設定すると、グループ内で同時に走るタスク数が指定上限以下に保たれます。上限に達している間、`ErrGroup.go` は実行中のタスクが完了して空きスロットが生じるまで呼び出し元で待機します。

一方、`ErrGroup.try_go` は空きスロットがあれば起動して `Result.Ok ()` を返し、空きがなければ待機せず渡した `Owned.Function` をそのまま `Result.Error f` として呼び出し元へ返却します。

```tsuzuri run=rejected_code%3D77%20wait_ok%3Dtrue
let group: ErrGroup<i64> = ErrGroup.create ()
ErrGroup.set_limit (ref group) 1

let gate: Channel<unit> = Channel.make 0
let worker_gate = Channel.share gate
ErrGroup.go (ref group) (Owned.function (\() -> {
    let _v = Channel.recv worker_gate;
    Result.Ok ()
}))

let rejected_code =
    match ErrGroup.try_go (ref group) (Owned.function (\() -> Result.Error 77)) with
    | Result.Ok _ -> 0
    | Result.Error returned_fn ->
        match Owned.call (ref returned_fn) () with
        | Result.Error code -> code
        | Result.Ok _ -> 0

Channel.close gate
let wait_ok = Result.is_ok (ref (ErrGroup.wait (ref group)))
$"rejected_code={rejected_code} wait_ok={wait_ok}"
```

### サブタスクからの動的追加（`share`）

サブタスクの内部からさらに同じグループへタスクを追加したい場合は、`ErrGroup.share` でグループハンドルを複製して `Owned.function` 内へ渡します（ただし `set_limit` を併用している場合、実行中のタスク自身が `ErrGroup.go` で空きスロットを待つと全スロットを親タスクが占有してデッドロックになりうるため注意してください）。

## 制約事項・トラップ条件・ターゲット動作

- **稼働中の `set_limit` 変更禁止**: グループ内で 1 つでもタスクが実行中の状態で `ErrGroup.set_limit` を呼び出すとアサーション違反としてトラップします。上限の設定は必ず `go` / `try_go` でタスクを投入する前に行うか、`ErrGroup.wait` で全タスクが完了した後に行ってください。なお `set_limit 0` を設定した状態で `ErrGroup.go` を呼ぶと空きスロットが生じるまで待機します（`try_go` は常に `Result.Error` を返します）。
- **エラー選択の順序**: `ErrGroup.wait` が返すエラーは入力順ではなく、実行時に最初に `Result.Error` を返して完了したタスクのエラーです。入力インデックス順の結果配列が必要な場合は [`Routine.scope`](./routine.md) で `Result<'a, 'e>` の配列を受け取ります。
- **不透明所有型**: `ErrGroup<'e>` は非 `Copy` の不透明型（直接構築・分解は `E1022`）であり、再利用可能な通常の関数値への捕捉は `E1005` となります。
- **対応ターゲット**: ネイティブ 5 環境、および `--wasm-feature jspi` を指定した `wasm32` で動作します（JSPI なしの WebAssembly では `E2000`）。

## 引数の順序

`ErrGroup` モジュールはリソースハンドルの例外分類に属するため、`create` と `with_context`（第1引数が親の `ref Context`）を除くすべての操作関数で操作対象のグループハンドル `ref ErrGroup<'e>` を**第1引数**に取ります（`ErrGroup.go (ref group) f`、`ErrGroup.set_limit (ref group) n`）。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

`std::ErrGroup` モジュールの全 8 公開関数の一覧です。

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `ErrGroup<'e>` | 型（不透明レコード、非 `Copy`, `Send`, `Sync`） | エラー伝播・キャンセル・並列度制限を備えたタスクグループハンドル |
| `ErrGroup.create` | `Send<'e> => own unit -> ErrGroup<'e>` | `Context.background ()` を親とする新しいグループを生成する |
| `ErrGroup.with_context` | `Send<'e> => ref Context -> ErrGroup<'e>` | 指定した親コンテキストから派生したコンテキストを持つグループを生成する |
| `ErrGroup.context` | `ref ErrGroup<'e> -> Context` | グループのコンテキストを指す新しいハンドルを取得する |
| `ErrGroup.go` | `Send<'e> => ref ErrGroup<'e> -> own Owned.Function<unit, Result<unit, 'e>> -> unit` | 空きスロットを待って新しい `tzroutine` で関数を起動する |
| `ErrGroup.try_go` | `Send<'e> => ref ErrGroup<'e> -> own Owned.Function<unit, Result<unit, 'e>> -> Result<unit, Owned.Function<unit, Result<unit, 'e>>>` | スロットに空きがあれば起動して `Ok ()` を返し、上限到達中なら起動せず関数を `Error` で返す |
| `ErrGroup.set_limit` | `ref ErrGroup<'e> -> own i64 -> unit` | 同時実行タスク数の上限を設定する（負数で上限解除、タスク実行中の呼び出しはトラップ） |
| `ErrGroup.wait` | `ref ErrGroup<'e> -> Result<unit, 'e>` | 全タスクの完了を待機し、グループコンテキストをキャンセルして最初のエラーまたは `Ok ()` を返す |
| `ErrGroup.share` | `ref ErrGroup<'e> -> ErrGroup<'e>` | 同じグループを指す新しい所有ハンドルを生成する |

## 関連項目

- [Context](./context.md)
- [WaitGroup](./waitgroup.md)
- [Semaphore](./semaphore.md)
- [Routine](./routine.md)
- [Owned](../memory/owned.md)
- [Result](../core/result.md)
- [引数の順序](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
