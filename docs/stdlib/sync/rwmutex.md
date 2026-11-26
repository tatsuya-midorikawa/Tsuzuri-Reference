# RwMutex

`RwMutex<'a>` は、保護対象の値 `'a` を内部に一体保持し、多数のタスクによる同時読み取り（共有読み取りロック）と単一タスクによる排他更新（排他書き込みロック）を切り替える読み書きロックです。設定テーブル、ルーティング表、インメモリキャッシュのように、読み取り頻度が高く書き込み頻度が低い共有状態の保護に適しています。

`RwMutex` は名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールです。

## 要点

- `RwMutex.create value` で保護値（`Send<'a>` が必須）を包んだロックを生成し、`RwMutex.with_read` は共有借用 `ref 'a`、`RwMutex.with_write` は排他借用 `ref mut 'a` をコールバックへ渡す。ロックはコールバック終了時に自動解放される。
- 書き込みロックが保持されていない限り、複数の `tzroutine` が同時に `with_read` のクリティカルセクションへ入ることができる。一方、`with_write` は他のすべての読み取りタスクと書き込みタスクを排他する。
- **書き込み優先（ライタ飢餓防止）方針**: 書き込みタスクが待機を開始すると、後続の新規読み取り要求は書き込み完了後へ回される。これにより読み取り要求が絶え間なく到着するワークロードでも書き込みタスクが飢餓状態に陥らない。
- **非再入性**: すでに同一の `RwMutex` を保持している `tzroutine` が重ねて `with_read` または `with_write` を呼ぶと、待機中の書き込みタスクとのデッドロックを防ぐため即座にトラップする（読み取りロック保持中の再帰的 `with_read` も不可）。
- 複数のタスク間で `Arc<RwMutex<'a>>` や `Routine.scope` を介して共有するには、複数の読み手が同時に `ref 'a` を参照するため、`'a` が `Send` だけでなく `Sync` も満たしている必要がある。

## 基本的な使い方

`RwMutex.with_write` で排他的に状態を更新し、`RwMutex.with_read` で複数タスクから並行に読み取ります。単独所有に戻ったロックからは `RwMutex.into_inner` でロック取得なしに所有値を取り出せます。

```tsuzuri run=readers_sum%3D240%20final%3D30
let config = RwMutex.create 10i64
RwMutex.with_write (ref config) (\v -> deref v = deref v * 3)

let partial = Routine.scope (ref config) 8 (\lock _idx ->
    RwMutex.with_read lock (\v -> deref v))

let final_val = RwMutex.into_inner config
$"readers_sum={Array.sum (ref partial)} final={final_val}"
```

### `Arc<RwMutex<'a>>` による並行タスク間の共有

呼び出し元のスコープを超えて生存する `tzroutine` 間で共有する場合は `Arc.new (RwMutex.create ...)` を用います。

```tsuzuri run=version%3D2%20name_len%3D10
record Snapshot {
    version: i64,
    name: string,
}

let store = Arc.new (RwMutex.create (Snapshot { version: 1, name: "init" }))
let wg = WaitGroup.create ()

let writer = Arc.share (ref store)
WaitGroup.go (ref wg) (Owned.function (\() ->
    RwMutex.with_write (Arc.get (ref writer)) (\s ->
        deref s = Snapshot { version: 2, name: "production" })))

WaitGroup.wait (ref wg)

let summary = RwMutex.with_read (Arc.get (ref store)) (\s ->
    $"version={s.version} name_len={String.length (ref s.name)}")
summary
```

## `Mutex` との比較と使い分け

| 観点 | `RwMutex<'a>` | [`Mutex<'a>`](./mutex.md) |
| --- | --- | --- |
| 読み取りの並列性 | 複数タスクが同時に `ref 'a` を参照可能 | 読み取りも 1 タスクずつ直列化 |
| `Sync` 成立条件 | `'a: Send` かつ `'a: Sync` | `'a: Send` のみで `Sync` 成立 |
| ロック語のサイズ | 64 ビット（読み手数 62 bit＋待機・保持フラグ 2 bit） | 32 ビット |
| 適したワークロード | 読み取りが支配的で、読み取り処理自体に一定の計算量がある状態 | 読み書きが同程度、または保護対象が `Sync` でない型 |

クリティカルセクションが整数 1 個の加算のように極めて短い場合は、ロック管理の単純な `Mutex` やロックフリーな [`Atomic`](./atomic.md) の方が低オーバーヘッドです。

## 借用・再入・ターゲット規則

- **借用の持ち出し禁止**: [`Mutex.with_lock`](./mutex.md) と同様、`with_read` および `with_write` のコールバック戻り値は `Send` を満たし、ロック内部の値への参照や借用環境付きクロージャを含んではなりません（`E1013`）。またコールバック内で取得した内部参照を外部の `Mutex` や配列へ書き出して延命させることも `E1013` で拒否されます。
- **同一タスクによる再入禁止**: 読み取りロックを保持しているタスクが内側の関数で同じ `RwMutex` に対して再度 `with_read` を呼んだ場合、もし別タスクが `with_write` を要求して待機中であると、新規読み取りがブロックされて自己デッドロックが発生します。これを防ぐため、ランタイムは保持中タスクによる同一 `RwMutex` への再ロック（読み→読み、読み→書き、書き→読み、書き→書きのすべて）を検出し、`RwMutex cannot be locked again by the tzroutine that holds it` でトラップします。
- **ロック保持中の待機**: 異なるロックの獲得やチャネル待機・`Time.sleep` 等をロック保持中に行うことは可能ですが、その間は待機中の書き手や後続の読み手もブロックされるため、ロック保持時間は最小限に保つことが推奨されます。
- **対応ターゲット**: ネイティブ 5 環境、および `--wasm-feature jspi` を指定した `wasm32` で完全動作します。既定の単一スレッド WebAssembly でも `tzroutine` を起動しない単一フロー内で利用でき、競合待機が発生した場合のみトラップします。

## 引数の順序

`RwMutex` モジュールはリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、`with_read`・`with_write`・`into_inner` は操作対象のロック `ref RwMutex<'a>`（または `RwMutex<'a>`）を**第1引数**に取ります。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

`RwMutex` モジュールの全 4 公開関数の一覧です。

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `RwMutex<'a>` | 型（不透明レコード、非 `Copy`） | 64 ビットロック語と保護値 `'a` を一体保持する読み書きロック |
| `RwMutex.create` | `Send<'a> => 'a -> RwMutex<'a>` | 初期値を格納した未ロック状態の `RwMutex<'a>` を生成する |
| `RwMutex.with_read` | `Send<'b> => ref RwMutex<'a> -> (ref 'a -> 'b) -> 'b` | 共有読み取りロックを獲得して `ref 'a` をコールバックへ渡し、完了後に解放して結果を返す |
| `RwMutex.with_write` | `Send<'b> => ref RwMutex<'a> -> (ref mut 'a -> 'b) -> 'b` | 排他書き込みロックを獲得して `ref mut 'a` をコールバックへ渡し、完了後に解放して結果を返す |
| `RwMutex.into_inner` | `RwMutex<'a> -> 'a` | `RwMutex` の所有権を消費し、内部の所有値 `'a` をロックなしで取り出す |

## 関連項目

- [Mutex](./mutex.md)
- [SyncMap](./syncmap.md)
- [Atomic](./atomic.md)
- [Rc と Arc](../memory/rc.md)
- [引数の順序](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
