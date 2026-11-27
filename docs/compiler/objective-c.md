# Objective-C 連携（`extern class` と `ObjC`）

macOS（Apple Silicon）では、Objective-C のクラスを Tsuzuri の型として宣言し、Cocoa（Foundation・AppKit など）のメソッドを宣言どおりの C の型で直接呼び出せます。C のラッパーや `objc_msgSend` の手書きの宣言は要りません。クラスの値は Objective-C の物体への強い参照を 1 つ所有し、スコープを抜けると自動的に release されます。生ポインター型・ポインター演算・`unsafe` は導入しておらず、安全性の根拠は `extern def` と同じく「宣言が正しいこと」です。

## 要点

- `extern class NSWindow : NSResponder { ... }` でクラスを型として宣言します。値はムーブされ、drop のときに release されます。nil は `Maybe<C>` の `None` で表します。
- 既定のクラスは作成したスレッドに束縛されます（`extern type local` と同じ規則）。どのスレッドからも使えるクラスは `extern class sync C : Base` と宣言します。
- メンバーは `C.member (ref receiver) args...` の形で呼び、`objc_msgSend` の直接の呼び出しに下がります。`bool` は `BOOL`、`f32`・`f64` は浮動小数点レジスター、`@c_layout` のレコードは構造体の値渡し・値返しです。
- 結果の所有は Cocoa の命名規則（alloc・new・copy・mutableCopy・init の族）で決まります。retain・release を手で書く必要はありません。
- 組み込みのモジュール `ObjC` が `retain`・`upcast`・`upcast_owned`・`downcast`・`sel`・`literal` を提供します。
- Objective-C を使うプログラムは Apple のターゲットでだけビルドできます。`-lobjc` はコンパイラが自動で足し、framework は `--framework AppKit` などで指定します。

## クラスの宣言

```text
extern ["実行時名"] class [sync] Name : Base [ { メンバー... } ]
extern category Name : Class { メンバー... }
```

基底は必須で、根は組み込みの型 `ObjC.Object`（Objective-C の `id`）です。宣言の連鎖はホストの階層の一部でかまいません（`NSNumber : NSObject` のように途中を省けます）。Tsuzuri の型に継承はなく、基底への暗黙の変換もありません。基底として使うときは `ObjC.upcast` を書きます。

```tsuzuri
@trusted
extern class NSObject : ObjC.Object

@trusted
extern class NSResponder : NSObject

/// 実行時のクラス名は NSWindow。
@trusted
extern "NSWindow" class Window : NSResponder

@trusted
extern class sync NSNumber : NSObject
```

- 文字列を 1 つ書くと実行時のクラス名になります（C の識別子で 255 バイトまで）。省略すると型の名前がそのまま使われます。
- `class` は予約語の新しい位置、`sync`（`class` の直後で、同じ行に名前が続くとき）と `category`（`extern` の直後）は文脈キーワードです。`extern class sync : NSObject` は `sync` という名前のクラスです。
- 連鎖の深さは 32 までです。循環は `E1008`（`objc_class_base_cycle`）、基底がクラスでないと `E1003`（`objc_class_base_not_class`）になります。
- `private extern class` と、ほかのモジュールからの `Module.Name` は `extern type` と同じ規則です。2 つのモジュールが同じクラスを別々に宣言すると別の型になるので、クラスの宣言は 1 つのモジュールに集めます。

### 値の性質

| 型 | 所有 | スレッド | 備考 |
| --- | --- | --- | --- |
| `extern class C`・`ObjC.Object` | 強い参照を 1 つ所有（drop で release） | 作成したスレッドに束縛（非 `Send`・非 `Sync`、`pinned` 効果） | 関数値に捕捉できません（`E1005`） |
| `extern class sync C` | 同上 | `Send` かつ `Sync` | tzroutine の本体へムーブでき、`Arc<C>` で共有できます |
| `ObjC.Class`・`ObjC.Sel` | 所有なし（`Copy`） | `Send` かつ `Sync` | `Class` と `SEL` |

- クラスの値は `Copy` でも `Clone` でもありません。参照を増やすときは `ObjC.retain` を使います。record・union・タプル・`Maybe`・`Vec`・配列に格納できます。
- `Maybe<C>` はポインター 1 つで表され、`None` が nil です。`Maybe` でない `C` の位置に nil が返ると、境界で `null extern handle` のトラップになります。
- `sync` の基底を持つクラスは `sync` でなければなりません（`E1008` `objc_class_sync_base`）。
- スレッドに束縛されたクラスを tzroutine や `Parallel.*` で開始する関数が触ると `E1013`（`pinned_code_spawned`）です。

## メンバーとメッセージ送信

クラスとカテゴリーの本体には、呼び出すメソッドを宣言します。

```text
[@returns_retained | @returns_not_retained] [class] ["セレクター"] name :: 関数型
```

```tsuzuri
@trusted
extern class NSObject : ObjC.Object {
    class alloc :: unit -> Self
    init :: unit -> Maybe<Self>
}

@trusted
extern class NSValue : NSObject

@trusted
extern class NSNumber : NSValue {
    class "numberWithDouble:" with_double :: f64 -> Self
    "doubleValue" double_value :: unit -> f64
    "boolValue" bool_value :: unit -> bool
}

@trusted
extern class NSString : NSObject {
    "initWithBytes:length:encoding:" init_with_bytes :: ref [ubyte] -> i64u -> Maybe<Self>
    length :: unit -> i64u
    "isEqualToString:" is_equal_to_string :: ref NSString -> bool
}

def describe :: unit -> string = \() ->
    let number = NSNumber.with_double 2.5
    let bytes = Utf8String.to_bytes u8"こんにちは"
    match NSString.init_with_bytes (NSString.alloc ()) (ref bytes) 4i64u with
    | Maybe.None -> "no string"
    | Maybe.Some text ->
        let expected: NSString = ObjC.literal "こんにちは"
        let same = NSString.is_equal_to_string (ref text) (ref expected)
        $"{NSNumber.double_value (ref number)} {NSString.length (ref text)} {same}"
```

- インスタンスメソッド `m :: P1 -> ... -> R` は `C.m :: ref C -> P1 -> ... -> R` として呼びます（受け手が最初の引数。引数のないメソッドは `unit -> R` と宣言し、`C.m (ref receiver)` と呼びます）。先頭に `class` を付けたクラスメソッドは受け手を取りません（`NSObject.alloc ()`）。
- セレクターは文字列で書きます。引数のないメンバーは省略でき、名前がそのままセレクターになります。セレクターは識別子 1 つ（`length`）か、`識別子:` のくり返し（`setTitle:`、`initWithBytes:length:encoding:`）で、1,024 バイトまでです。
- セレクターの `:` の数は、C の引数の数と一致しなければなりません。バッファ（`ref [T]`・`ref string` など）はポインターと要素数（`i64`）の 2 つの引数になります。`:` より引数が多いメンバー（可変長のメソッド）は宣言できません（`E1008` `objc_variadic_method`）。
- 基底のメンバーは派生の名前で呼べます（`NSWindow.alloc ()`）。受け手の型と、結果の `Self`・`Maybe<Self>`（Objective-C の `instancetype`）は、呼び出しに使ったクラスになります。
- カテゴリーは型ではなく名前空間です。`extern category Geometry : NSView { ... }` のメンバーは `Geometry.m (ref view)` と呼びます。
- メンバーは、すべての引数を与えた直接の呼び出しでだけ使えます。関数値や部分適用は `E1008`（`objc_method_not_called`）です。同じ名前を連鎖の中（基底を含む）で 2 度宣言すると `E1001`（`duplicate_objc_member`）です。

### 所有の規則

| メンバー | 結果 | 扱い |
| --- | --- | --- |
| alloc・new・copy・mutableCopy の族、`@returns_retained` | +1 | そのまま所有します |
| init の族 | +1 | 受け手を消費し、結果を所有します（`C.init :: C -> Maybe<C>`） |
| それ以外、`@returns_not_retained` | +0 | 受け取った直後に retain します |

族は、セレクターの最初の部分から先頭の `_` を除いたものが `alloc`・`new`・`copy`・`mutableCopy`・`init` で始まり、その次の文字が小文字でないときに決まります（`newObject`・`copyWithZone:`・`initWithFrame:` は族、`newer`・`copying`・`initialize` は族の外）。族は結果が物体のときだけ効き、`init` はインスタンスメソッドに限ります。物体の引数は `ref C`・`Maybe<ref C>`（借用）で書きます。所有する `C` の引数は `E1008`（`objc_owned_object_argument`）です。

`init` が nil を返したとき、受け手は呼ばれた側がすでに解放しています。結果は `None` になり、何も残りません。

### 型の対応

| Tsuzuri | Objective-C | 備考 |
| --- | --- | --- |
| `bool` | `BOOL` | 1 bit の真偽値として渡します（`extern def` の `bool` は 32-bit）。`ref mut bool` は `BOOL *` |
| `i8`・`i8u`・`i16`・`i16u` | `char`・`unsigned char`・`short`・`unsigned short` | その幅のまま |
| `i32`・`i32u`・`i64`・`i64u`・`f32`・`f64` | `int`・`unsigned`・`long`（`NSInteger`）・`unsigned long`（`NSUInteger`）・`float`・`double`（`CGFloat`） | |
| `ref C`・`Maybe<ref C>` | 物体の引数 | nil は `None` |
| `C`・`Maybe<C>`・`Self`・`Maybe<Self>` | 物体の結果 | 所有の規則のとおり |
| `ObjC.Sel`・`ObjC.Class` | `SEL`・`Class` | |
| `@c_layout` のレコード `R` | 構造体の値 | `NSPoint`・`NSSize`・`NSRect`・`NSRange` など |
| ハンドル、`ref R`・`ref mut R`、バッファ、コールバック、`FnPtr` | `extern def` と同じ | [ネイティブ連携と C ABI](./native-interop.md) |

`@c_layout` のないレコードの値（引数と結果）とバッファの結果は `E1008`（`objc_member_type`）です。`@c_layout` のレコードは、引数にも結果にも値で書けます。構造体は次のように宣言して値で受け渡します。

```tsuzuri
@c_layout
record NSPoint { x: f64, y: f64 }

@c_layout
record NSSize { width: f64, height: f64 }

@c_layout
record NSRect { origin: NSPoint, size: NSSize }

@trusted
extern class NSObject : ObjC.Object {
    class alloc :: unit -> Self
}

@trusted
extern class NSWindow : NSObject {
    "initWithContentRect:styleMask:backing:defer:" init_with_content_rect :: NSRect -> i64u -> i64u -> bool -> Maybe<Self>
    frame :: unit -> NSRect
    "setReleasedWhenClosed:" set_released_when_closed :: bool -> unit
    close :: unit -> unit
}
```

## 組み込みのモジュール `ObjC`

`ObjC` は標準ライブラリのファイルを持たない組み込みのモジュールです（利用者の `ObjC.tz` は `E1011`）。関数は直接の呼び出しでだけ使えます（関数値は `E1008` `objc_builtin_not_called`）。

| 名前 | 型 | 意味 |
| --- | --- | --- |
| `ObjC.Object`・`ObjC.Class`・`ObjC.Sel` | 型 | `id`・`Class`・`SEL` |
| `ObjC.retain` | `ref C -> C` | 同じ物体の所有値をもう 1 つ作ります |
| `ObjC.upcast` | `ref C -> ref B` | 基底の型の借用として見ます（コストなし） |
| `ObjC.upcast_owned` | `C -> B` | 所有値の型を基底に変えます（コストなし） |
| `ObjC.downcast` | `ref C -> Maybe<D>` | 物体が `D` のインスタンスなら retain して `Some`、そうでなければ `None` |
| `ObjC.sel` | `string -> ObjC.Sel` | 文字列リテラルか `const` の文字列のセレクター |
| `ObjC.literal` | `string -> NSString` | 補間のない文字列リテラルの定数 NSString（Objective-C の `@"..."`） |

`ObjC.upcast`・`upcast_owned`・`downcast`・`literal` の結果の型は、束縛や引数の型注釈（期待型）から決まります。決まらないときは `E1015` です。`upcast` の目的の型は、引数のクラス自身か、宣言の連鎖の祖先（`ObjC.Object` を含む）でなければなりません（`E1003` `objc_not_superclass`）。`ObjC.literal` の期待型は、実行時名が `NSString` のクラス、その基底、`ObjC.Object` のどれかです（`E1003` `objc_literal_type`）。

### 引数の順序

`ObjC` の関数は 1 引数で、その引数が対象です。メンバーの呼び出しは、利用者が宣言する `extern` のメンバーなので標準ライブラリの「対象は最後」の規約（[標準ライブラリの設計規約と引数順序](../stdlib/conventions.md)）の対象外で、Objective-C のメソッド呼び出しと同じく受け手を最初に置きます。

## `extern def` と Objective-C の型

C の関数にも物体を受け渡せます。

| 位置 | 書ける型 | 所有 |
| --- | --- | --- |
| 引数 | `ref C`・`Maybe<ref C>` | +0（借用） |
| 結果 | `C`・`Maybe<C>` | +0 として受け取り、直後に retain します。`@returns_retained` を付けると +1 として受け取ります |
| 引数・結果・静的コールバックの引数 | `ObjC.Class`・`ObjC.Sel` | 所有なし |

`export def`、`@c_layout` のフィールド、`FnPtr<F>`、コールバックの物体、アドレスを受け取る `extern view`（`i64 -> T` のメモリービュー）、`ref mut`、バッファの要素には Objective-C の型を置けません（`E1008` `objc_object_position`）。名前付きのデータシンボルを読む `extern view` は別で、物体を保持する C の大域変数を `extern "sym" view def f :: unit -> C`（または `Maybe<C>`）で読めます（読んだ値は retain されます）。

## ターゲット・リンク・監査

- `tsuzuri check` はどのホストでも宣言と使用を受理します。`build` で到達した Objective-C の使用は、WebAssembly では `E1008`（`abi_native_only`）、Apple でないネイティブのターゲットでは `E1008`（`abi_apple_only`）になります。宣言だけなら出力は変わりません。
- Objective-C を使うプログラムのリンクには、コンパイラが `-lobjc` を足します。framework のクラスには `--framework Foundation`・`--framework AppKit`（または `Tsuzuri.toml` の `[native] frameworks`）が要ります。
- `@weak` を `extern class` の前に書くと、古い OS にないクラスを宣言できます。クラスの参照を読むたびに不在を検査し、不在ならメッセージを出してトラップします。
- `ObjC.retain`・`ObjC.downcast`・メッセージ送信・物体の drop は効果 `extern` と権限 `ffi` の対象です。`@trusted` のない `extern class`・`extern category` を使うと `W1010` の対象になり、`tsuzuri audit` はクラスとカテゴリーごとに行を出します。継承したメンバーを派生クラスの名前で呼ぶ送信（`Derived.m`）は、呼び出しが名指すクラスと、メンバーを宣言した基底クラスの両方の使用として数えます（`@trusted` のない基底クラスは、`@trusted` の付いた派生クラスを通して使っても `W1010` の対象です）。
- tzroutine を起動するプログラムでは、メッセージ送信は外部関数の呼び出しと同じくブロッキング呼び出しとして扱われ、送信の間にほかの tzroutine が進めます。

## 注意と制限

- **autorelease pool**: +0 の結果は受け取った直後に retain しますが、呼ばれた側の中で autorelease された物体は pool に入ります。pool は `objc_autoreleasePoolPush`・`objc_autoreleasePoolPop` を `extern` で宣言して使います。pool は OS スレッドのものです。tzroutine は待機から別のワーカースレッドで再開することがあるので、tzroutine を起動するプログラムでは、push・作業・pop の全体を 1 つの [`Routine.with_locked_thread`](../stdlib/sync/routine.md) のコールバックの中で実行します（push と違うスレッドで pop すると異常終了します）。pool のないスレッドで autorelease された物体は、そのワーカースレッドが終わるまで残ります。tzroutine が終わってもワーカースレッドは終わらないので、そこでは解放されません。
- **`releasedWhenClosed`**: コードで作った `NSWindow` は、既定では `close` のときに自分を release します。Tsuzuri の所有と二重になるので、`close` の前に `setReleasedWhenClosed:` へ `false` を送ります。
- **セレクターの省略**: 名前とセレクターが同じときだけ省略できます。`double_value :: unit -> f64` はセレクター `double_value` に送り、実行時に例外で異常終了します。
- **バッファの長さ**: 長さは要素の数です。`ref [i64]` を `initWithBytes:length:` に渡してもバイト数にはなりません。
- **例外**: Objective-C の例外が Tsuzuri のフレームを越えると異常終了します。
- クラスの定義・プロトコル・`super` への送信、Block、物体の出力引数（`NSError **`）、弱い参照、可変長のメソッドは扱えません。

## 関連項目

- [ネイティブ連携と C ABI](./native-interop.md)
- [対応プラットフォームとクロスコンパイル](./platforms.md)
- [契約と属性](../expressions/contracts-and-attributes.md)
- [診断メッセージとエラーコード](./diagnostics.md)
- [標準ライブラリの設計規約と引数順序](../stdlib/conventions.md)
- [tzroutine による軽量並行処理](../concurrency/tzroutine.md)
