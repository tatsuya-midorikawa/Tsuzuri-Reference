# FnPtr

`FnPtr<'f>` は、クロージャ環境を持たないトップレベル関数の C ABI ラッパーを指す静的関数ポインタ型です。C ライブラリの構造体（ウィンドウクラスやコールバックテーブルなど）に関数ポインタを格納したい場合や、Tsuzuri 側のデータ構造で関数ポインタを保持して `extern` 関数へ渡したい場合に使用します。

`FnPtr` は予約されたモジュール・組み込み型名であり、同名のユーザーモジュール宣言は `E1011`、同名の型宣言は `E1001` になります。

## 要点

- `FnPtr.of f` は、型パラメータも環境捕捉も持たないトップレベルのユーザー定義関数 `f` から `FnPtr<'f>` 値を生成する。ラムダ式、部分適用、ローカル関数、標準ライブラリ関数、`extern` 関数を渡すと `E1008` となる。
- `FnPtr<'f>` は 1 ポインタ幅のスカラー値であり、`Copy`・`Capture`・`Send`・`Sync` のすべてを満たす。ただし Tsuzuri の通常の関数値 `'a -> 'b` とは別の型であり、Tsuzuri 側から直接呼び出すことはできない。
- Tsuzuri からネイティブ C 側への一方向受け渡し（`extern def` の引数など）にのみ使用でき、ホスト側から任意のアドレスを受け取る方向は `E1008` で拒否される。
- ネイティブターゲット専用であり、WebAssembly ターゲットで使用すると `E1008` となる。
- C コールバック内から Tsuzuri 側のアプリケーション状態を参照・更新する必要がある場合は、userdata トークンと組み合わせる [Anchor](./anchor.md) を併用する。

## 基本的な使い方

C ABI 互換の引数・戻り値型を持つトップレベル関数を定義し、`FnPtr.of` にその関数名を直接渡して `FnPtr<'f>` を取得します。取得した値はレコードのフィールドや配列に格納できます。

```tsuzuri run=style%3D3%20count%3D2
record HandlerEntry {
    style: i32u,
    callback: FnPtr<(i64 -> i32u -> i64)>,
}

def on_command :: i64 -> i32u -> i64 = \id code ->
    if code == 1i32u then id else 0

def on_close :: i64 -> i32u -> i64 = \_id _code -> 0

let entries = [
    HandlerEntry { style: 3i32u, callback: FnPtr.of on_command },
    HandlerEntry { style: 1i32u, callback: FnPtr.of on_close },
]
$"style={entries[0].style} count={entries.length}"
```

同じトップレベル関数を `extern` のコールバック引数と `FnPtr.of` の双方で使用した場合でも、コンパイラが出力する C ABI ラッパー関数は単一のシンボルに共有されます。

## 型引数 `'f` の条件と正規化

`FnPtr<'f>` の型引数 `'f` には、静的 C コールバックとして有効な関数型を指定します。

- **使用可能な引数型**: C ABI 互換の整数・浮動小数点・`bool`・ポインタ互換の不透明 `extern type` ハンドル（およびネイティブターゲットでの null 許容 `Maybe<H>` / `Maybe<ref H>`）。
- **使用可能な戻り値型**: C ABI 互換のスカラー型または `unit`（C の `void` に対応）。
- **関数型の正規化**: カリー化された多引数関数型 `A -> B -> C` は、C の多引数関数ポインタ `C (*)(A, B)` として正規化されます。また `pure` 修飾や引数所有権注釈（`own`）の違いは `FnPtr` の型上では正規化され、同じ引数・戻り値列を持つ関数は同一の `FnPtr` 型になります。
- **スレッド拘束ハンドルの扱い**: `extern type local` のハンドルを扱う関数も `FnPtr.of` に渡せます。C 側からコールバックが呼ばれた際は、呼び出しを行ったその OS スレッド上で実行されます。

```tsuzuri
extern type copy WindowHandle

type EventCallback = FnPtr<(WindowHandle -> i32u -> i64u -> i64 -> i64)>

@trusted
extern "DefWindowProcW" def default_proc :: WindowHandle -> i32u -> i64u -> i64 -> i64

def custom_proc :: WindowHandle -> i32u -> i64u -> i64 -> i64 = \hwnd msg wparam lparam ->
    default_proc hwnd msg wparam lparam

def make_callback :: unit -> EventCallback = \() ->
    FnPtr.of custom_proc
```

## ホスト境界とライフタイムの規則

- **一方向の ABI 境界**: `FnPtr<'f>` は `extern def` の引数としてホスト C 関数へ渡すことができます。一方、`extern def` の戻り値、`export def` の引数および戻り値、ホスト境界を越えるスカラーレコードのフィールドなど、ホストから未検証の関数ポインタ値を受け取る経路はすべて `E1008` で拒否されます。
- **非 NULL 保証**: Tsuzuri 側で NULL の `FnPtr` を生成する手段はなく、`FnPtr.of` が返すポインタは常に有効なラッパー関数を指します。
- **C ヘッダ出力**: リンク名を持たない `extern def` の引数に `FnPtr<'f>` を使用した場合、`--emit header` は対応する C の関数ポインタ型（例: `int64_t (*arg0)(int32_t)`）を出力します。
- **有効期間**: 生成された C ABI ラッパー関数は、`main` の実行中であれば任意の OS スレッドから呼び出せます。`main` が終了した後に C 側から呼び出された場合はトラップします。

## 引数の順序

`FnPtr.of` は対象のトップレベル関数名 1 つだけを引数に取る単一引数組み込みであり、引数順序の曖昧さはありません（[引数の順序](../conventions.md)）。

## API リファレンス

| 名前 | 種別 / 型シグネチャ | 説明 |
| --- | --- | --- |
| `FnPtr<'f>` | 組み込み型（`Copy`, `Capture`, `Send`, `Sync`） | 関数型 `'f` に対応する静的 C ABI 関数ポインタ型 |
| `FnPtr.of` | `'f -> FnPtr<'f>` | 環境を持たない具体的なトップレベルユーザー関数から C ABI 関数ポインタを取得する（直接適用必須） |

## 関連項目

- [Anchor](./anchor.md)
- [ZString](../text/zstring.md)
- [ネイティブ連携（C ABI）](../../compiler/native-interop.md)
