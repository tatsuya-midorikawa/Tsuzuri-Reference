# Exception

`Exception` は、`try ... with` 式のハンドラが受け取る標準の例外レコード型です。Tsuzuri `0.1.0` においてランタイムから送出される例外は、`@checked` 修飾された整数演算の桁あふれを表す `OverflowException` のみです。これらの型とケースは自動インポートされており、追加の `using` 宣言なしで使用できます。

## 要点

- 例外種別を表す `union ExceptionKind = OverflowException` と、例外本体を表す `record Exception { kind: ExceptionKind, msg: string }` で構成されます。
- `Exception` は組み込み型クラス `Err` を実装しているため、`try ... with` のハンドラからそのまま返して `Result<'a, Exception>` の `Error` 値を構築できます。
- ユーザーコードから任意の例外を `raise` / `throw` する構文は存在しません。一般的な失敗の伝播には [Result](./result.md) を使用します。
- ゼロ除算・境界外添字・`assert` 失敗は例外ではなく言語トラップであり、`try ... with` では捕捉されません（純粋計算のトラップ隔離には [Domain](./domain.md) を使用します）。

## 型定義と `Err` インスタンス

| 名前 | 定義 | 説明 |
| --- | --- | --- |
| `ExceptionKind` | `union ExceptionKind = OverflowException` | `try ... with` が捕捉する例外の種別。ハンドラ内の `e is OverflowException` パターンで判定される |
| `Exception` | `record Exception { kind: ExceptionKind, msg: string }` | ハンドラに渡される例外レコード。`msg` には説明文字列が格納される |

`@checked` 算術演算がオーバーフローした際に生成される `msg` は固定文字列 `"Arithmetic operation resulted in an overflow."` です（内部補助関数 `Exception.of_code` は `private` であり、ユーザーコードからは呼び出せません）。

### 組み込み型クラス `Err`

`try ... with` のハンドラ節が返す型 `'e` は、組み込み型クラス `Err<'e>` を実装している必要があります。

```text
class Err<'a> {
    def msg :: ref 'a -> string
}

instance Err<Exception> {
    fn msg error = clone_string (ref error.msg)
}
```

## 引数の順序

`Exception` モジュール自体は公開関数を持たず、型定義と `Err<Exception>` インスタンスのみを提供します。`Err.msg` メソッドは1引数（`ref 'a -> string`）であり、引数順序の曖昧さはありません（[標準ライブラリの設計規約と引数の順序](../conventions.md)）。

## 基本的な使い方

### オーバーフロー例外の捕捉とメッセージ取得

`Exception` の `msg` フィールドは非 `Copy` の `string` 型です。ハンドラや呼び出し元で `let m = e.msg` のように直接フィールドを取り出すと部分ムーブが発生し、`e` 全体をそれ以降使用できなくなります。`e` の所有権を保ったまま文字列を取得するには、`Err.msg (ref e)` を呼ぶか、文字列補間 `$"{e.msg}"` で共有借用します。

```tsuzuri run=Arithmetic%20operation%20resulted%20in%20an%20overflow.
def safe_add :: i32 -> i32 -> Result<i32, Exception> = \x y ->
    try
        @checked x + y
    with
    | e is OverflowException -> e

match safe_add 2147483647 1 with
| Ok value -> to_string (value as i64)
| Error err -> Err.msg (ref err)
```

`Exception` レコードと `OverflowException` ケースは公開されているため、テスト用などに値を直接構築することもできます（ただし送出構文はありません）。

```tsuzuri run=synthetic%20error
let sample = Exception { kind: OverflowException, msg: "synthetic error" }
Err.msg (ref sample)
```

### 独自エラー型への変換

ユーザー定義の型に `Err` インスタンスを実装すれば、`try ... with` ハンドラ内で捕捉した例外を独自のドメインエラー型へ直接変換して返せます。

```tsuzuri run=overflow-code%3D100
record CalcError { code: i32 }

instance Err<CalcError> {
    fn msg err = $"overflow-code={err.code}"
}

def checked_inc :: i32 -> Result<i32, CalcError> = \x ->
    try
        @checked x + 1
    with
    | _ is OverflowException -> CalcError { code: 100 }

match checked_inc 2147483647 with
| Ok value -> to_string (value as i64)
| Error err -> Err.msg (ref err)
```

複数のハンドラ節を書く場合、すべての節が同一のエラー型を返す必要があります。節ごとに異なる型（例: `Exception` と `CalcError`）を返すと型不一致エラー `E1003` となります。

## 所有権と境界条件

- **非 `Copy` 型**: `Exception` は `string` を保持するため `Copy` ではありません。また `Display` インスタンスを持たないため、トップレベル式や `IO.writeln` で結果を表示する際は `match` で分岐するか `Err.msg` で文字列を取り出します。
- **関数内スコープの捕捉**: Tsuzuri の例外送出は同一関数内の字句的な `try ... with` に対してのみ働き、コールスタックを遡る大域的なスタック巻き戻しは行いません。`try` の外で発生した `@checked` オーバーフローは未処理例外としてトラップします。

## 関連項目

- [Result](./result.md)
- [Domain](./domain.md)
- [エラー処理と try 式](../../expressions/error-handling.md)
- [型クラスと制約](../../types/type-classes.md)
