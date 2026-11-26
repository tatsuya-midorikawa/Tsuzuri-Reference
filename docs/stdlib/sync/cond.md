# Cond

`Cond` は、[`Mutex`](./mutex.md) で保護された共有状態が特定の述語（条件）を満たすまで `tzroutine` を効率的に待機させ、状態変化時に起床を通知する条件変数です。ビジーウェイト（ポーリング）を行わずに、状態遷移の完了待ち、リソースプールの空き待ち、バリア同期などを実装できます。

`Cond` は名前を参照したプログラムにのみ読み込まれるオプトイン標準モジュールです。

## 要点

- `Cond.create ()` で条件変数ハンドルを生成し、`Cond.share` でハンドルを複製して各 `tzroutine` へ配布する（最後のハンドルの `Drop` で内部領域が解放される）。
- `Cond.wait_with cond mutex predicate body` は、ロック獲得・述語検査・条件未達時のロック一時解放とスリープ・起床後のロック再獲得と述語再評価・条件成立時の本体実行を単一の安全なプロトコルとして一括処理する。
- 状態を変更した側は、`Mutex.with_lock` 等で値を書き換えた後に `Cond.signal`（待機タスクを 1 つ起床）または `Cond.broadcast`（待機中の全タスクを起床）を呼び出す。
- 特定の単一 `Mutex` に固定束縛されず、`wait_with` の呼び出しごとに対象の `ref Mutex<'a>` を組み合わせられる。

## 基本的な使い方

`Cond.wait_with` は第3引数に待機継続を判定する読み取り述語 `ref 'a -> bool`、第4引数に条件成立後に排他ロック下で実行する本体 `ref mut 'a -> 'b` を受け取ります。述語が `true` を返すまで自動的にループ再評価するため、スプリアスウェイクアップ（偶発的な起床）や他タスクに先を越された場合でも条件未達のまま本体が実行されることはありません。

```tsuzuri run=acquired%3D100%20remaining%3D20
def run_pool :: unit -> string
fn run_pool _ =
    let balance = Arc.new (Mutex.create 40i64)
    let changed = Cond.create ()

    let producer_bal = Arc.share (ref balance)
    let producer_cv = Cond.share (ref changed)
    tzroutine {
        Mutex.with_lock (Arc.get (ref producer_bal)) (\b -> deref b = deref b + 80)
        Cond.signal (ref producer_cv)
    }

    let remaining =
        Cond.wait_with (ref changed) (Arc.get (ref balance)) (\b -> deref b >= 100) (\b -> {
            deref b = deref b - 100;
            deref b
        })
    $"acquired=100 remaining={remaining}"

run_pool ()
```

### `signal` と `broadcast` の使い分け

- **`Cond.signal`**: 待機中のタスクのうちいずれか 1 つが処理を進められる場合（例: ワークキューへ要素を 1 件追加したとき）に使用します。ただし、起床した 1 タスクが自分の求める条件を満たさなかった場合に他の待機タスクが起きない可能性があるため、待機側の条件式がタスクごとに異なる場合は `broadcast` を用います。
- **`Cond.broadcast`**: 共有フェーズの移行、シャットダウン通知、複数単位のリソース解放など、複数の待機タスクが進行可能になる場合や各タスクが異なる閾値を待っている場合に使用します。

```tsuzuri run=woke%3D4
let phase = Arc.new (Mutex.create 0i64)
let cv = Cond.create ()
let woke = Arc.new (Atomic.create 0i64)
let wg = WaitGroup.create ()

for target in 1i64 ..= 4 do
    let p = Arc.share (ref phase)
    let c = Cond.share (ref cv)
    let w = Arc.share (ref woke)
    WaitGroup.go (ref wg) (Owned.function (\() -> {
        Cond.wait_with (ref c) (Arc.get (ref p)) (\v -> deref v >= target) (\_v -> ());
        let _old = Atomic.fetch_add (Arc.get (ref w)) 1;
        ()
    }))

for step in 1i64 ..= 4 do
    Mutex.with_lock (Arc.get (ref phase)) (\v -> deref v = step)
    Cond.broadcast (ref cv)

WaitGroup.wait (ref wg)
$"woke={Atomic.load (Arc.get (ref woke))}"
```

## 通知ロスト防止と借用・ターゲット規則

- **エポック番号による通知ロスト防止**: `Cond` の内部状態は 64 ビットの単調増加シーケンス番号で管理されます。`wait_with` は `Mutex` 保持中に現在の番号を読み取り、ロックを解放してから「番号が変化するまで」スリープします。通知側（`signal` / `broadcast`）は番号をインクリメントしてから待機タスクを起こすため、「述語が偽と判定してからスリープに入るまでの隙間」に別スレッドが状態を更新して通知した場合でも通知を取りこぼすことはありません（ただし状態更新自体は必ず対応する `Mutex` のロック内で行ってください）。
- **借用と所有権の検査**: [`Mutex.with_lock`](./mutex.md) と同様、`wait_with` の本体戻り値 `'b` は `Send` を満たし、ロック内部の値への借用や借用環境付きクロージャをロック外へ持ち出すことはできません（`E1013`）。述語や本体の中で取得した内部参照を外部の別セルへ書き出すことも `E1013` となります。
- **ハンドルの特性**: `Cond` は非 `Copy` の不透明所有ハンドル（直接構築・フィールド参照は `E1022`）であり、`Send` かつ `Sync` を満たします。通常の関数値への捕捉は `E1005` となるため、`Cond.share` で複製したハンドルを `tzroutine` や `Owned.function` へ渡します。
- **対応ターゲット**: ネイティブ 5 環境、および `--wasm-feature jspi` を指定した `wasm32` で完全動作します。既定の単一スレッド WebAssembly では、初回評価で述語が `true` の場合はそのまま本体を実行し、`false` で待機が必要になった時点で起床要因がないためトラップします。

## 引数の順序

`Cond` モジュールはリソースハンドル（コンパイラ組み込みハンドル）の例外分類に属するため、すべての操作関数で条件変数ハンドル `ref Cond` を**第1引数**に取ります（`Cond.wait_with cond mutex predicate body`）。詳細は [引数の順序](../conventions.md) を参照してください。

## API リファレンス

`Cond` モジュールの全 5 公開関数の一覧です。

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `Cond` | 型（不透明ハンドル、非 `Copy`, `Send`, `Sync`, `Drop`） | 参照カウント管理される条件変数ハンドル |
| `Cond.create` | `unit -> Cond` | 新しい条件変数を生成する |
| `Cond.wait_with` | `Send<'b> => ref Cond -> ref Mutex<'a> -> (ref 'a -> bool) -> (ref mut 'a -> 'b) -> 'b` | `mutex` を獲得し、述語が `true` になるまでロック解放・待機を繰り返し、成立後に本体を実行してロックを解放する |
| `Cond.signal` | `ref Cond -> unit` | 待機中のタスクがあればそのうち 1 つを起床させる |
| `Cond.broadcast` | `ref Cond -> unit` | 待機中のすべてのタスクを起床させる |
| `Cond.share` | `ref Cond -> Cond` | 同じ条件変数を指す新しい所有ハンドルを生成する |

## 関連項目

- [Mutex](./mutex.md)
- [Semaphore](./semaphore.md)
- [ErrGroup](./errgroup.md)
- [引数の順序](../conventions.md)
- [tzroutine](../../concurrency/tzroutine.md)
