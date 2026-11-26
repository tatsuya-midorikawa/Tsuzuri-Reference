# Once と OnceValue

`Once` と `OnceValue<'a>` は、複数の `tzroutine` から競合して呼び出されても初期化処理をプロセス内で最大 1 回だけ実行し、その完了を全呼び出し元に対して同期保証する一度限りの初期化プリミティブです。

戻り値を持たない副作用付きの初期化処理（グローバルリソースの準備やログ基盤のセットアップなど）には `Once` を使用し、初期化した不変データを生成して以降の呼び出しでロックフリーに共有参照したい場合には遅延初期化セル `OnceValue<'a>` を使用します。どちらも名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールです。

## 要点

- `Once.call once f` は最初の呼び出しでのみ `f ()` を実行する。初期化実行中に到着した他の並行呼び出しは、`f ()` が完了して戻るまで待機してから復帰する。
- `OnceValue.get cell init` は最初の呼び出しで `init ()` を実行して結果をセルへ格納し、すべての呼び出し元へ共有借用 `ref 'a` を返す。初期化完了後の 2 回目以降の読み取りは `acquire` ロードのみでロックを介さず高速に完了する。
- `Once` は参照カウント付きハンドルであり `Once.share` で複製して配布する。一方、`OnceValue<'a>` は値を内包するセル型であり、[`Routine.scope`](./routine.md) の共有借用または [`Arc<OnceValue<'a>>`](../memory/rc.md) に包んで配布する。
- 初期化関数の中から同じ `Once` または `OnceValue` 自身を再帰的に呼び出すと、自身の完了を待つ自己デッドロックとなりトラップする。

## `Once` と `OnceValue` の使い分け

| 観点 | `Once` | `OnceValue<'a>` |
| --- | --- | --- |
| 目的 | 副作用を伴う初期化手続きの 1 回実行 | 値の遅延構築とロックフリーな共有参照 |
| 結果の取得 | なし（`unit`）、完了判定は `Once.done` | `OnceValue.get` で `ref 'a`、所有権回収は `OnceValue.into_inner` |
| タスク間の共有方法 | `Once.share` でハンドルを複製 | `Arc<OnceValue<'a>>` または `Routine.scope` で借用共有 |
| 型制約 | なし | `OnceValue.get` に `Send<'a>` かつ `Sync<'a>` が必要 |
| 単一スレッド遅延評価との違い | 複数 `tzroutine` 間で安全（`Send` + `Sync`） | 複数 `tzroutine` 間で安全（単一スレッド専用なら [`Lazy`](../../concurrency/lazy.md)） |

## `Once`：一度限りの初期化実行

`Once.create ()` で未実行状態のハンドルを作成し、`Once.call` に初期化コールバック `unit -> unit` を渡します。`Once.call` が返った時点では、自分が実行した場合でも別タスクが実行した場合でも、初期化処理が完了していることが保証されます。

```tsuzuri run=runs%3D1%20done_before%3Dfalse%20done_after%3Dtrue
let init_gate = Once.create ()
let done_before = Once.done (ref init_gate)
let runs = Arc.new (Atomic.create 0i64)
let wg = WaitGroup.create ()

for _i in 0 ..< 6 do
    let gate = Once.share (ref init_gate)
    let cnt = Arc.share (ref runs)
    WaitGroup.go (ref wg) (Owned.function (\() -> {
        let cnt_cell = Arc.get (ref cnt);
        Once.call (ref gate) (\() -> {
            let _prev = Atomic.fetch_add cnt_cell 1;
            ()
        })
    }))

WaitGroup.wait (ref wg)
let done_after = Once.done (ref init_gate)
$"runs={Atomic.load (Arc.get (ref runs))} done_before={done_before} done_after={done_after}"
```

`Once.call` に渡す関数は呼び出しの間だけ同期的に使われる通常の関数値であるため、スタック上の借用を捕捉していても構いません。

## `OnceValue<'a>`：スレッド安全な遅延初期化セル

`OnceValue.create ()` で未初期化の空セルを作成し、`OnceValue.get` に構築関数 `unit -> 'a` を渡します。最初に到達した呼び出しが値 `'a` を構築して `release` ストアで公開し、以降のすべての呼び出しは同じ値への共有借用 `ref 'a` を受け取ります。

```tsuzuri run=built%3D1%20total%3D168%20inner%3D42
record SharedInit {
    cache: OnceValue<i64>,
    builds: Atomic<i64>,
}

let state = SharedInit {
    cache: OnceValue.create (),
    builds: Atomic.create 0i64,
}

let reads = Routine.scope (ref state) 4 (\s _idx -> {
    let counter = ref s.builds;
    let v = OnceValue.get (ref s.cache) (\() -> {
        let _old = Atomic.fetch_add counter 1;
        42i64
    });
    deref v
})

match state with
| SharedInit { cache = cache, builds = builds } ->
    let count = Atomic.into_inner builds
    let extracted = Maybe.default_value 0 (OnceValue.into_inner cache)
    $"built={count} total={Array.sum (ref reads)} inner={extracted}"
```

`OnceValue.into_inner` は単独所有の `OnceValue<'a>` を消費し、すでに一度でも `get` で値が構築されていれば `Maybe.Some value` を、一度も初期化されていなければ `Maybe.None` を返します。

### `OnceValue` の型制約と借用規則

- **`Send` + `Sync` 要件**: 複数の `tzroutine` が同時に `OnceValue.get` から `ref 'a` を取得できるため、格納する型 `'a` は `Send` かつ `Sync` を満たす必要があります（`Rc` などは格納不可、`E1013`）。
- **返却ライフタイム**: `OnceValue.get` が返す `ref 'a` は引数として渡した `ref OnceValue<'a>` と同じライフタイムに紐づきます（セル本体より長く参照を保持すると `E1013`）。
- **借用環境の禁止**: 構築関数が返す値 `'a` はセル内に保持され続けるため、関数型などを格納する場合は外部変数の借用を保持しないことが静的に証明できなければなりません（外部を借用する初期化関数や戻り値は `E1013`）。クロージャを格納したい場合は `\_unit -> { let k = 10; \x -> x + k }` のように初期化関数の内部で完結して構築します。

## 所有権・再入・ターゲット動作

- **不透明表現と捕捉制限**: `Once` と `OnceValue<'a>` はどちらも非 `Copy` の不透明型（直接構築・分解は `E1022`）であり、再利用可能な通常の関数値への捕捉は `E1005` で拒否されます。`OnceValue<'a>` の実体はヒープ上の 1 要素配列にあるため、外側のレコードをムーブしてもアドレスは安定しています。
- **再帰初期化の禁止**: `Once.call` や `OnceValue.get` のコールバック内部から同一インスタンスの `Once.call` / `OnceValue.get` を呼び出すと、進行中の自身の完了を永久に待つデッドロックとなり、ランタイムのデッドロック検出によってトラップします。
- **対応ターゲット**: ネイティブ 5 環境、および `--wasm-feature jspi` を指定した `wasm32` で完全動作します。既定の単一スレッド WebAssembly でも `tzroutine` を起動しないプログラムでそのまま利用できます（再帰呼び出し時はトラップ）。

## 引数の順序

`Once` と `OnceValue` はともにリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、すべての操作関数で操作対象のハンドル `ref Once` または `ref OnceValue<'a>`（`into_inner` では `OnceValue<'a>`）を**第1引数**に取ります（`Once.call once f`、`OnceValue.get cell init`）。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

### `Once` モジュール（全 4 公開関数）

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `Once` | 型（不透明ハンドル、非 `Copy`, `Send`, `Sync`, `Drop`） | 一度限りの実行を保証する参照カウント付きハンドル |
| `Once.create` | `unit -> Once` | 未実行状態の新しい `Once` ハンドルを生成する（組み込み） |
| `Once.call` | `ref Once -> (unit -> unit) -> unit` | 初回呼び出しでのみ関数を実行し、並行する他呼び出しは完了まで待機する |
| `Once.done` | `ref Once -> bool` | 初期化関数の実行が完了していれば `true` を返す（組み込み） |
| `Once.share` | `ref Once -> Once` | 同じ `Once` 状態を指す新しい所有ハンドルを生成する（組み込み） |

### `OnceValue` モジュール（全 3 公開関数）

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `OnceValue<'a>` | 型（不透明レコード、非 `Copy`） | 一度だけ値を構築して保持する並行遅延初期化セル |
| `OnceValue.create` | `unit -> OnceValue<'a>` | 未初期化状態の空の `OnceValue<'a>` セルを生成する |
| `OnceValue.get` | `(Send<'a>, Sync<'a>) => ref OnceValue<'a> -> (unit -> 'a) -> ref 'a` | 未初期化なら関数で値を構築して格納し、格納値への共有借用を返す |
| `OnceValue.into_inner` | `OnceValue<'a> -> Maybe<'a>` | セルを消費し、初期化済みなら `Some 値`、未初期化なら `None` を返す |

## 関連項目

- [Mutex](./mutex.md)
- [RwMutex](./rwmutex.md)
- [Routine](./routine.md)
- [Rc と Arc](../memory/rc.md)
- [引数の順序](../conventions.md)
- [遅延評価（Lazy）](../../concurrency/lazy.md)
