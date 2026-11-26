# Regex

`Regex` は、`string`（UTF-16）と `utf8string`（UTF-8）の双方に対して線形時間保証付きの正規表現検索・捕捉・置換・分割を提供する opt-in 標準モジュールです。実行エンジンにはキャプチャ付き Thompson NFA を並列駆動する Pike VM を採用しており、バックトラックを行わないため、任意のパターンと入力の組み合わせに対して計算量爆発（ReDoS）が構造的に発生しません。

併せて提供される opt-in 型クラスモジュール `RegexText`（`std/RegexText.tt`）により、`*_text` 系関数を通じて `string` と `utf8string` を単一のジェネリックコードで扱えます。

## 要点

- パターンは常に `string` で記述し、`Regex.compile` によって一度だけ `Result<Regex, Regex.Error>` へコンパイルします。構文エラー・未対応構文・資源上限超過はいずれもトラップせず `Result.Error` を返します。
- 優先順位は Perl / RE2 / Rust `regex` と同じ **leftmost-first**（最左・選択順優先）であり、1 回の探索時間は $O(\text{命令数} \times \text{入力スカラー数})$ です。
- 返却される一致区間 `(start, end)` は半開区間 `[start, end)` であり、`string` では UTF-16 コード単位、`utf8string` ではバイト単位です（常にスカラー境界上に位置します）。
- 文字クラス `\d`・`\w`・`\s`・単語境界 `\b`・`i` フラグのケースフォールディングは既定で Unicode 17.0.0 に準拠し、`(?-u)` フラグで ASCII 限定に切り替えられます。
- 線形時間保証を維持するため、後方参照（`\1` 等）・先読み / 後読み・名前付きグループ・アトミックグループはサポート外（`ErrorKind.Unsupported`）としています。

## 引数の順序

[標準ライブラリの設計規約](../conventions.md)に従い、検索・置換・分割の対象となるテキスト（`ref string`・`ref utf8string`・`ref 's`）は常に最後の引数です。コンパイル済み `ref Regex` が第 1 引数、開始オフセットや置換テンプレートがその中間に置かれるため、パイプライン `|>` や関数合成 `>>` とそのまま組み合わせられます。

- `Regex.find re text` / `Regex.find_at re start text`
- `Regex.replace_all re replacement text`（`replacement` と `text` は同型のため順序に注意してください）

```tsuzuri run=%2817%2C%2018%29%20order%20%23%20shipped%20%23%202
let re = Regex.compile "\\d+" |> Result.get
let text = "order 66 shipped 7"
let mark = "#"
let later = ref text |> Regex.find_at (ref re) 8 |> Maybe.default_value (-1, -1)
let masked = ref text |> Regex.replace_all (ref re) (ref mark)
let count = ref text |> (Regex.find_all (ref re) >> Array.length)
$"{later} {masked} {count}"
```

部分適用 `Regex.replace_all (ref re) (ref mark)` では、借用引数を一時リテラルではなく `let` 束縛した変数にして渡します（一時値の借用部分適用は `E1013`）。

## 基本的な使い方と `RegexText` による共通化

コンパイル済みの `Regex` は不変・非 `Copy` の値であり、共有借用 `ref Regex` を通じて `string`・`utf8string` の双方に繰り返し再利用できます。

```tsuzuri run=replaced%3Dmail%20example%3Aalice%20and%20test%3Abob%20groups%3D%5B%285%2C%2018%29%2C%20%285%2C%2010%29%2C%20%2811%2C%2018%29%5D
let re = Regex.compile "(\\w+)@(\\w+)" |> Result.get
let text = "mail alice@example and bob@test"
let replaced = Regex.replace_all (ref re) "${2}:${1}" (ref text)
let groups = Regex.captures (ref re) (ref text) |> Maybe.get
$"replaced={replaced} groups={groups}"
```

`string` と `utf8string` の両対応コードを書く場合は `Regex.*_text` 関数と `RegexText.RegexText<'s>` 制約を使用します（`RegexText` は opt-in モジュールのため、型クラス制約は `RegexText.RegexText<'s> =>` とモジュール修飾して記述します）。静的特殊化により辞書や間接呼び出しのオーバーヘッドは発生しません。

```tsuzuri run=%281%2C%202%29%20%285%2C%206%29%202%202
def match_count :: RegexText.RegexText<'s> => ref Regex -> ref 's -> i64
fn match_count re text = (Regex.find_all_text re text).length

let re = Regex.compile "\\d+" |> Result.get
let first16 = Regex.find_text (ref re) "a1b22" |> Maybe.default_value (-1, -1)
let first8 = Regex.find_text (ref re) u8"😀a1b22" |> Maybe.default_value (-1, -1)
$"{first16} {first8} {match_count (ref re) "a1b22"} {match_count (ref re) u8"😀a1b22"}"
```

## 公開関数一覧（全 25 関数）

### コンパイル・エスケープ・メタ情報・診断（4 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Regex.compile` | `ref string -> Result<Regex, Regex.Error>` | パターンを検証・コンパイルして `Regex` または詳細な `Error` を返す |
| `Regex.escape` | `ref string -> string` | 14 個のメタ文字 `^ $ \ . * + ? ( ) [ ] { } \|` を `\` でエスケープ |
| `Regex.group_count` | `ref Regex -> i64` | 全体一致（グループ 0）を除いた捕捉グループ `(...)` の総数 |
| `Regex.search_steps` | `ref Regex -> ref string -> i64` | `find` 実行時の Pike VM ステップ数（線形時間特性の検証・計測用） |

### `string` 向け照合・置換・分割（7 関数）

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Regex.is_match` | `ref Regex -> ref string -> bool` | パターンが `text` のいずれかの箇所に一致するか判定 |
| `Regex.find` | `ref Regex -> ref string -> Maybe<(i64 * i64)>` | 最初の一致区間 `(start, end)`（コード単位）を返す |
| `Regex.find_at` | `ref Regex -> i64 -> ref string -> Maybe<(i64 * i64)>` | `start` 以降の最初の一致を返す（範囲外・サロゲートペア内部は `None`） |
| `Regex.find_all` | `ref Regex -> ref string -> [(i64 * i64)]` | 左から重ならないすべての一致区間を返す |
| `Regex.captures` | `ref Regex -> ref string -> Maybe<[(i64 * i64)]>` | 要素 `0` に全体一致、要素 `k` に第 `k` グループ区間（不参加は `(-1, -1)`）を格納した配列を返す |
| `Regex.replace_all` | `ref Regex -> ref string -> ref string -> string` | 全一致を置換テンプレート（`${n}` でグループ展開、`$$` で `$`）で置換 |
| `Regex.split` | `ref Regex -> ref string -> [string]` | 一致箇所を区切りとして分割した部分文字列配列を返す |

### `utf8string` 向け照合・置換・分割（7 関数）

オフセットおよび区間の単位はすべて UTF-8 バイトです。`find_at_utf8` で `start` がマルチバイト文字の後続バイトを指す場合はトラップせず `None` を返します。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Regex.is_match_utf8` | `ref Regex -> ref utf8string -> bool` | `utf8string` に対する一致判定 |
| `Regex.find_utf8` | `ref Regex -> ref utf8string -> Maybe<(i64 * i64)>` | 最初の一致バイト区間 `(start, end)` |
| `Regex.find_at_utf8` | `ref Regex -> i64 -> ref utf8string -> Maybe<(i64 * i64)>` | バイト位置 `start` 以降の最初の一致（非スカラー境界・範囲外は `None`） |
| `Regex.find_all_utf8` | `ref Regex -> ref utf8string -> [(i64 * i64)]` | 重ならないすべての一致バイト区間 |
| `Regex.captures_utf8` | `ref Regex -> ref utf8string -> Maybe<[(i64 * i64)]>` | 全体一致と各捕捉グループのバイト区間配列 |
| `Regex.replace_all_utf8` | `ref Regex -> ref utf8string -> ref utf8string -> utf8string` | `utf8string` の全一致を置換テンプレートで置換 |
| `Regex.split_utf8` | `ref Regex -> ref utf8string -> [utf8string]` | 一致箇所で分割した `utf8string` 配列 |

### `RegexText` 多相関数（7 関数）

`class RegexText<'s>`（`is_match`・`find`・`find_at`・`find_all`・`captures`・`replace_all`・`split` の 7 メソッド）は `string` と `utf8string` に標準実装されています。以下のラッパー関数を使うと、`RegexText` を明示インポートせずとも型推論だけで両型を呼び分けられます。

| 関数 | シグネチャ | 説明 |
| --- | --- | --- |
| `Regex.is_match_text` | `RegexText<'s> => ref Regex -> ref 's -> bool` | `'s` に応じて `is_match` または `is_match_utf8` へ委譲 |
| `Regex.find_text` | `RegexText<'s> => ref Regex -> ref 's -> Maybe<(i64 * i64)>` | `'s` に応じて `find` または `find_utf8` へ委譲 |
| `Regex.find_at_text` | `RegexText<'s> => ref Regex -> i64 -> ref 's -> Maybe<(i64 * i64)>` | `'s` に応じて `find_at` または `find_at_utf8` へ委譲 |
| `Regex.find_all_text` | `RegexText<'s> => ref Regex -> ref 's -> [(i64 * i64)]` | `'s` に応じて `find_all` または `find_all_utf8` へ委譲 |
| `Regex.captures_text` | `RegexText<'s> => ref Regex -> ref 's -> Maybe<[(i64 * i64)]>` | `'s` に応じて `captures` または `captures_utf8` へ委譲 |
| `Regex.replace_all_text` | `RegexText<'s> => ref Regex -> ref 's -> ref 's -> 's` | `'s` に応じて `replace_all` または `replace_all_utf8` へ委譲 |
| `Regex.split_text` | `RegexText<'s> => ref Regex -> ref 's -> ['s]` | `'s` に応じて `split` または `split_utf8` へ委譲 |

## 正規表現構文と照合規則

構文は Unicode モードの正規表現サブセットであり、未エスケープの `{`・`}`・`]` や未知のエスケープは曖昧さを残さず構文エラーとして検出されます。

| 分類 | 構文 | 仕様 |
| --- | --- | --- |
| 任意文字・エスケープ | `.`, `\n`, `\r`, `\t`, `\f`, `\v`, `\0`, `\xHH`, `\uXXXX`, `\u{H...}` | `.` は `\n` 以外の 1 スカラー（`s` フラグで `\n` も含む）。隣接するサロゲート `\uXXXX` 対は 1 スカラーに結合 |
| 文字クラス | `[abc]`, `[a-z]`, `[^a]`, `\d`/`\D`, `\w`/`\W`, `\s`/`\S`, `\p{Name}`/`\P{Name}` | `\d` は `Nd`、`\w` は `Alphabetic ∪ M ∪ Nd ∪ Pc ∪ Join_Control`、`\s` は `White_Space`（`(?-u)` で ASCII 限定）。`\p{...}` は[`Unicode.property_ranges`](unicode.md)と同じ名前集合に対応 |
| アンカー・境界 | `^`, `$`, `\A`, `\z`, `\b`, `\B` | `m` フラグで `^`・`$` が `\n` 直後・直前にも一致。`find_at` でも `start` 以前のスカラーが `^`・`\b` 判定に反映される |
| グループ・フラグ | `(x)`, `(?:x)`, `(?ims-u:x)`, 先頭の `(?ims-u)` | `i`: 単純ケースフォールディング（状態 C・S）による大小文字非依存、`m`: 複数行、`s`: 単一行、`u`: Unicode（既定有効） |
| 量指定子 | `*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}`（末尾 `?` で最短一致 lazy） | `0 <= n <= m <= 1000`。反復内の捕捉グループは最後に参加した反復の区間を保持。空一致の直後は 1 スカラー進めて次探索を開始 |

## エラー型と資源上限

`Regex.Error` レコードは `{ kind: Regex.ErrorKind, offset: i64, message: string }` を持ち、`ErrorKind` は `Syntax`（構文エラー）・`Unsupported`（線形時間を破る後方参照や先読み等の未対応構文）・`TooLarge`（資源上限超過）の 3 バリアントです。

| 資源上限項目 | 上限値 | 超過時の `ErrorKind` |
| --- | --- | --- |
| パターン長 | 65,536 コード単位 | `TooLarge` |
| 回数指定 `{n,m}` の `n`, `m` | 1,000 | `TooLarge` |
| グループの最大ネスト深さ | 64 段 | `TooLarge` |
| 展開後の VM 命令数 | 10,000 命令 | `TooLarge` |
| 文字クラス区間数の総計 | 65,536 区間 | `TooLarge` |
| スレッド捕捉スロット数（`命令数 * 2 * (group_count + 1)`） | 262,144 | `TooLarge` |

```tsuzuri run=Syntax%200%20Unsupported%200
let e1 = match Regex.compile "(a" with
    | Result.Ok _ -> "ok"
    | Result.Error err -> $"{err.kind} {err.offset}"
let e2 = match Regex.compile "(?=a)" with
    | Result.Ok _ -> "ok"
    | Result.Error err -> $"{err.kind} {err.offset}"
$"{e1} {e2}"
```

## 関連項目

- [String](string.md)
- [Utf8String](utf8string.md)
- [Text](text.md)
- [Unicode](unicode.md)
- [Result](../core/result.md)
- [標準ライブラリの設計規約](../conventions.md)
