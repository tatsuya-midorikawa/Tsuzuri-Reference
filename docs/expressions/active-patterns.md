# アクティブパターン

アクティブパターンは、任意の判定・変換ロジックを持つ関数（認識器）を定義し、`match` 式などのパターン構文の中で通常の共用体ケースと同じように呼び出して分岐・データ抽出を行える機能です。内部表現を隠蔽したまま抽象的なビューを提供したり、文字列パーサや分類器を宣言的に記述したりする際に威力を発揮します。

## 要点

- アクティブパターンには、常に入力を変換する**単一ケース全域パターン `(|A|)`**、有限個のケースへ分類する**複数ケース全域パターン `(|A|B|)`**、および条件成立時のみ一致する**部分パターン `(|A|_|)`** の 3 形態があります。
- 部分パターン `(|A|_|)` はペイロードなしの `bool`、または抽出値を伴う `Maybe<T>` を返します。
- 複数ケース全域パターン `(|A|B|)` はシグネチャの戻り値型に専用マーカー `'T` を書き、本体内で宣言したケース名（`A`・`B`）を構築子として返します。
- 照合対象の値の前に追加パラメータ（設定値への参照や閾値など）を受け取る**パラメータ付きアクティブパターン**を定義できます。
- 認識器は専用の動的ディスパッチや暗黙のキャッシュを持たず、各アームの評価時に通常の静的関数呼び出しとして実行されます。

## アクティブパターンの 3 形態

| 種類 | 宣言構文 | 戻り値の型 | 主な用途 |
| --- | --- | --- | --- |
| 単一ケース全域 | `def (\|Name\|) :: In -> Out` | 任意の変換結果型 `Out` | 入力値の正規化、射影、長さや属性の抽出 |
| 複数ケース全域 | `def (\|A\|B\|) :: In -> 'T` | 専用マーカー `'T`（暗黙の共用体） | 入力値を排他的な複数カテゴリへ分類 |
| 部分パターン（判定のみ） | `def (\|Name\|_\|) :: In -> bool` | `bool` | 条件を満たす入力のみに一致（ペイロードなし） |
| 部分パターン（値抽出） | `def (\|Name\|_\|) :: In -> Maybe<Out>` | `Maybe<Out>` | パースや検索を行い、`Some` のとき抽出値を後続パターンへ渡す |

すべてのケース名は大文字の ASCII 英字で始める必要があります（小文字始まりは `E1020`）。また、複数ケースと部分パターンを混在させた `(|A|B|_|)` はサポートされておらず `E1020` になります。

---

## 完全（全域）アクティブパターン

### 単一ケース全域パターン `(|Name|)`

入力値を必ず別の表現へ変換して内側パターンへ渡します。

```tsuzuri run=42
def (|TrimmedLen|) :: string -> i64 = \text ->
    (String.trim text).length

match "   answer   " with
| TrimmedLen n -> n * 7
```

Edition 2027/2028 の通常の `def` と同様、無印の `string` 引数は共有借用として渡されるため、元の文字列を消費しません。

### 複数ケース全域パターン `(|A|B|)`

入力を複数の排他的なケースへ分類したい場合は、`(|Case1|Case2|...|)` を宣言し、戻り値型にこの認識器専用の暗黙共用体マーカー **`'T`** を指定します（入力型に `'T` を使うことや、利用者定義の共用体型を直接書いて返すことはできません）。

各ケースはペイロードなしにも、ケースごとに異なる型のペイロード付きにもできます。本体内で `Case value`（または `value |> Case`）として直接適用されたケースはペイロードを持つものとして推論されます。

```tsuzuri run=warm%3A25
def (|Freezing|Mild|Hot|) :: i64 -> 'T = \celsius ->
    if celsius <= 0 then Freezing
    elif celsius < 30 then Mild celsius
    else Hot (celsius - 30)

def describe_temp :: i64 -> string = \t ->
    match t with
    | Freezing -> "freezing"
    | Mild c -> $"warm:{c}"
    | Hot excess -> $"hot:+{excess}"
    | _ -> "unreachable"

describe_temp 25
```

宣言したケース名（`Freezing`・`Mild`・`Hot`）は、認識器の本体内では値を構築するコンストラクタとして機能し、外部のコードではパターンとして機能します。

---

## 部分アクティブパターン `(|Name|_|)`

入力が特定の条件を満たすときだけマッチさせ、不成立なら後続の `match` アームへ進ませたい場合は、末尾に `_` を置いた部分アクティブパターン `(|Name|_|)` を使います。

### bool を返す部分パターンと Maybe を返す部分パターン

判定のみを行う場合は `bool` を返し、判定と同時に変換後の値を取り出したい場合は `Maybe<Out>` を返します（`Maybe<unit>` を返す場合に限り、パターン側の `()` を省略できます）。

```tsuzuri run=even-int%3A42
def (|EvenInt|_|) :: i64 -> bool = \n ->
    n % 2 == 0

def (|IntText|_|) :: string -> Maybe<i64> = \text ->
    Parse.parse (String.trim text)

def classify_token :: string -> string = \raw ->
    match raw with
    | IntText (EvenInt as n) -> $"even-int:{n}"
    | IntText n -> $"odd-int:{n}"
    | _ -> "not-an-int"

classify_token "  42 "
```

上の `IntText (EvenInt as n)` のように、部分アクティブパターンの抽出結果に対してさらに別のアクティブパターンや `as` パターンを入れ子に組み合わせることもできます。

---

## パラメータ付きアクティブパターン

認識器が**照合対象の値より前**に追加の引数を取るように定義すると、パターン側で閾値や設定レコードへの参照などを渡せる**パラメータ付きアクティブパターン**になります。最後の引数が照合対象（スクルーティニー）に対応し、それより前の引数がパターン内に記述するパラメータになります。

```tsuzuri run=https-host%3Aexample.com
record EndpointRule { prefix: string, min_host_len: i64 }

def (|MatchingHost|_|) :: ref EndpointRule -> string -> Maybe<string> = \rule url ->
    if String.starts_with rule.prefix url then
        Maybe {
            let! rest = String.slice rule.prefix.length url.length url
            if rest.length >= rule.min_host_len then
                return rest
            else
                return! Maybe.None
        }
    else
        Maybe.None

let https_rule = EndpointRule { prefix: "https://", min_host_len: 3 }
let http_rule = EndpointRule { prefix: "http://", min_host_len: 3 }

let target = "https://example.com"
match target with
| MatchingHost (ref https_rule) host -> $"https-host:{host}"
| MatchingHost (ref http_rule) host -> $"http-host:{host}"
| _ -> "invalid-endpoint"
```

設定値を `ref EndpointRule` のように共有借用で渡すことで、`https_rule` を消費せずに複数の `match` や複数アームから安全に再利用できます。なお、一般の式をパターン内に直接記述できるのはこの「パラメータ付きアクティブパターンの実引数位置」のみであり、通常のパターン位置に計算式を書くとエラーになります。

---

## 網羅性検査・評価順序・名前解決の規則

### 網羅性検査での扱い

- **単一ケース全域パターン `(|Name|)`**: 内側のサブパターンが変数 `x` や `_` などの反駁不可能パターンであれば、その 1 アームだけで入力型全体を網羅します（ただし結果側を `| Parity true -> ... | Parity false -> ...` のように複数アームに分けても網羅とはみなされず、末尾に `_` が必要です）。
- **部分パターン `(|Name|_|)`**: 条件が不成立になりうるため網羅性には算入されず、後続のフォールバック節が必須です。
- **複数ケース全域パターン `(|A|B|)`**: 現在のコンパイラ実装では全ケースを列挙しても網羅性チェッカー上は未知のケースが残る扱いとなるため、末尾に `| _ -> unreachable ()` などのワイルドカード節を置いてください（省略すると `E1021` `missing: _` になります）。

### 評価と所有権のルール

- **キャッシュなしの逐次呼び出し**: アクティブパターンの認識器はアームごとに上から順へ通常の関数として呼び出され、結果の自動メモ化は行われません。重い前処理を複数のアームで共有したい場合は、`match` の前に一度 `let` で計算するか、単一ケース・複数ケースの全域パターンで 1 回で分類してください。
- **非 Copy スクルーティニーの借用**: 後続のアームでも同じスクルーティニーを照合できるよう、文字列やコレクションを受け取る認識器の入力引数は共有借用（Edition 2027/2028 の無印引数または明示的な `ref T`）にします。

### 可視性と名前解決

- 非公開にする場合は `private def (|Even|_|) ...` と宣言します（モジュール外からの使用は `E1022`）。
- 同一モジュール内の定義が最優先され、次にインポート済みユーザーモジュール、最後に標準ライブラリの順で解決されます。同順位に複数の候補がある場合は曖昧性エラー `E1004`（`ambiguous active pattern`）になるため、`Module.PatternName` とモジュール名で修飾します。既存の共用体ケース名や型名との同一モジュール内重複は `E1001` です。

---

## 実践例：設定行ミニパーサ

部分アクティブパターンとパラメータ付きアクティブパターンを組み合わせて、`key=value` 形式の設定行やコメント行を構造化データへ変換する例です。

```tsuzuri run=port%3D8080%2Cmode%3Dprod
def (|BlankOrComment|_|) :: string -> bool = \line ->
    let trimmed = String.trim line
    trimmed.length == 0 || String.starts_with "#" trimmed

def (|KeyValue|_|) :: string -> string -> Maybe<(string * string)> = \sep line ->
    Maybe {
        let! idx = String.find sep line
        let! raw_key = String.slice 0 idx line
        let! raw_val = String.slice (idx + sep.length) line.length line
        let key = String.trim raw_key
        let val = String.trim raw_val
        if key.length > 0 then
            return (key, val)
        else
            return! Maybe.None
    }

let lines = [
    "# server config",
    "  port = 8080  ",
    "",
    "mode = prod"
]

let mut out = Vec.empty()
for line in lines do
    match line with
    | BlankOrComment -> ()
    | KeyValue "=" (k, v) -> Vec.push $"{k}={v}" out
    | _ -> Vec.push "invalid" out

String.join "," (Vec.to_array out)
```

## 関連項目

- [パターンマッチング](./pattern-matching.md)
- [関数](./functions.md)
- [条件分岐](./conditionals.md)
- [判別共用体](../types/unions.md)
- [Maybe](../stdlib/core/maybe.md)
- [String](../stdlib/text/string.md)
- [借用と参照](../ownership/borrowing.md)
