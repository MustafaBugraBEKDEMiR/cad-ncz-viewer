# cad-ncz-viewer — Web Tabanlı CAD & Netcad (`.ncz`) Görüntüleyici

Tamamen istemci tarafında (tarayıcı içinde), sunucu yüklemesi veya derleme (build) adımı gerektirmeden çalışan, sıfır harici bağımlılıklı (Pure Vanilla ES6 Modules + HTML5 Canvas) açık kaynak **CAD, Harita/CBS ve Netcad (`.ncz`)** dosya görüntüleyicisidir. **GitHub Pages** üzerinden doğrudan statik olarak yayınlanacak şekilde tasarlanmıştır.

- **Canlı Demo (GitHub Pages):** https://mustafabugrabekdemir.github.io/cad-ncz-viewer/
- **Doğrudan Örnek Bağlantıları:** `?sample=ncz` | `?sample=dxf` | `?sample=ncn`
- **Kaynak Depo:** https://github.com/MustafaBugraBEKDEMiR/cad-ncz-viewer

---

## Özellikler Özeti

- **Netcad `.ncz` / `.nca` Yerel Desteği:** Klasik ikili TLV (Tag-Length-Value) akışlı `.ncz` dosyalarını ve modern ZIP paketli `.ncz` arşivlerini sunucuya göndermeden tarayıcıda çözer.
- **Çoklu CAD, CBS ve 3B Ağ (Mesh) Desteği:** `.ncz`, `.nca`, `.dxf`, `.ncn`, `.xyz`, `.txt`, `.geojson`, `.json`, `.kml`, `.kmz`, `.svg`, `.obj` ve `.stl` biçimlerini tek bir birleşik geometri modeline aktarır.
- **Yüksek Hassasiyetli Büyük Koordinat Çizimi:** ITRF96 / TM30 (EPSG:5254 vb.) gibi 7 haneli UTM koordinatlarında (`~4.400.000 m`) titreme/kırılma (Float32 jitter) oluşmadan pürüzsüz yakınlaştırma (zoom) ve kaydırma (pan).
- **Etkileşimli CAD Araçları:**
  - **OSNAP (Nesne Yakalama):** Uç nokta (Endpoint), orta nokta (Midpoint) ve daire/yay merkezi (Center) yakalama.
  - **Mesafe ve Alan Ölçümü:** Dinamik çok noktalı uzunluk toplamı ve Shoelace formülü ile alan hesabı.
  - **3B Yörünge (Orbit) Modu:** Kot (`Z`) verisi içeren çizimleri ve `.obj`/`.stl` ağlarını 3 boyutlu döndürerek inceleme.
  - **Y↔X Eksen Değişimi:** Haritacılık (Sağa/Yukarı) ve matematiksel (X/Y) eksen düzenleri arasında anında geçiş.
- **Katman Yönetimi & Özellik Denetçisi:** Katman açma/kapatma, tekil katmana odaklanma (isolate), katman filtreleme, nesne arama, proje metaverisi (CRS/EPSG, oluşturucu, sürüm) ve Netcad Tag 14 gömülü BMP önizleme kartı.
- **İstemci İçi Dışa Aktarma:** Görüntülenen çizimi **GeoJSON**, **DXF**, **SVG** veya **PNG** olarak indirme.
- **Çift Dil & Tema:** Türkçe / İngilizce arayüz (`TR` / `EN`) ile Koyu Blueprint, Antrasit ve Açık Kağıt temaları.

---

## Desteklenen Dosya Biçimleri

| Biçim | Uzantı(lar) | Desteklenen Özellikler |
| :--- | :--- | :--- |
| **Netcad Binary & Arşiv** | `.ncz`, `.nca` | Klasik TLV akışı (Katmanlar, Nokta, Doğru, Çember, Yay, Yazı, Sembol, Çoklu Doğru, Kapalı Alan, `VT_*` DB anahtarları, Tag 14 BMP, Tag 28 `REF`/`PRJPAR` XML), CP1254 Türkçe karakterler, ZIP konteynerli arşivler |
| **AutoCAD ASCII DXF** | `.dxf` | `HEADER`, `TABLES/LAYER`, `BLOCKS`/`INSERT` özyinelemeli açılımı, `LINE`, `LWPOLYLINE` + `bulge` yayları, `POLYLINE`/`VERTEX`, `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE`, `TEXT`, `MTEXT`, `SOLID`, `3DFACE`, `DIMENSION` |
| **Netcad / Arazi Nokta** | `.ncn`, `.xyz`, `.txt` | Nokta No, Y (Sağa), X (Yukarı), Z (Kot) ve nokta koduna göre otomatik katmanlama |
| **GeoJSON** | `.geojson`, `.json` | `Point`, `MultiPoint`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`, `FeatureCollection` öznitelikleri |
| **Google Earth** | `.kml`, `.kmz` | `Placemark`, `Folder` katmanları, `Point`, `LineString`, `Polygon` ve `PKZIP` `.kmz` açılımı |
| **Vektör Çizim** | `.svg` | `<line>`, `<rect>`, `<circle>`, `<ellipse>`, `<polyline>`, `<polygon>`, `<path>` (`M/L/H/V/C/Q/Z`), `<text>` |
| **3B Mesh** | `.obj`, `.stl` | Wavefront `.obj` yüzeyleri ve grupları (`g`/`o`), ASCII STL ve Binary STL üçgen yüzleri |

---

## Neler Yapıldı ve Nasıl Yapıldı? (Teknik Mimari)

### 1. Sıfır Bağımlılık & Sıfır Derleme (Zero-Build) Modüler Yapı
GitHub Pages doğrudan statik dosya sunduğu için Webpack/Vite/Node.js derleme hattına ihtiyaç duymayan, tarayıcıların yerel **ES6 Modül (`<script type="module">`)** desteğini kullanan temiz bir mimari kuruldu. Tüm veriler kullanıcının kendi tarayıcısında bellekte işlenir; hiçbir çizim dosyası dış sunucuya yüklenmez.

### 2. Netcad `.ncz` İkili Akış (TLV) ve ZIP Çözümleyicisi ([`ncz-parser.js`](js/parsers/ncz-parser.js))
Netcad klasik `.ncz` dosyaları, dosya başında katman ve proje başlıklarını, devamında ise art arda sıralanmış **`[Tag: uint8][Size: uint32 LE][Payload: Size byte]`** biçimindeki TLV kayıtlarını içerir:
- **Katman Tablosu (`Tag 6`):** 9 baytlık başlığın ardından her biri **29 bayt** uzunluğunda katman kayıtları okunur (ACI renk indeksi, çizgi tipi, bayraklar ve CP1254 kodlamalı kısa metin katman adı).
- **Geometri Kayıtları (`Tag 21` ve `Tag 22`):** Ortak 81 baytlık (`0x51`) geometri başlığından tür (`geomType`), katman indeksi, ana koordinatlar (`c1 = Yukarı/Northing`, `c2 = Sağa/Easting`, `z = float32`) ve sınırlayıcı kutu okunur. `Tag 22` kayıtlarında ise `0x51..0x6C` aralığındaki 28 baytlık veritabanı bağlantı bloğundan (`dbTable`, `dbKey`, ör. `VT_PARSEL` / `101/1`) tablo ve anahtar bilgisi çekilir. Desteklenen tipler: Nokta (`1`), Doğru (`2`), Çember (`3`), Yay (`4`), Yazı (`5`), Sembol (`6`), Çoklu Doğru/Alan (`7`), Kutu (`8`).
- **Gömülü Önizleme (`Tag 14`) ve Projeksiyon (`Tag 28`):** `BM` imzalı gömülü BMP küçük resmi `Blob URL` olarak Denetçi panelinde gösterilir; `REF`/`PRJPAR` bloklarındaki XML etiketlerinden (`<DatumName>`, `<EPSG>`) projeksiyon bilgisi ayıklanır.
- **Windows-1254 (CP1254) Dekoderi ([`cp1254.js`](js/utils/cp1254.js)):** Eski Netcad dosyalarındaki Türkçe karakterlerin (`ç, ğ, ı, İ, ö, ş, ü`) bozulmadan okunması için tarayıcı bağımsız CP1254→Unicode eşleme tablosu yazıldı; metin tabanlı formatlarda (`DXF`, `NCN`) UTF-8 / CP1254 otomatik algılaması eklendi.
- **ZIP Konteynerli NCZ & KMZ ([`zip.js`](js/utils/zip.js)):** Modern `PK\x03\x04` imzalı `.ncz` veya `.kmz` arşivleri, harici ZIP kütüphanesi olmadan EOCD + Central Directory okunarak ve tarayıcının yerleşik `DecompressionStream('deflate-raw')` API'si ile açılarak içindeki `.nca`, `.gml` veya `.kml` verisi çıkarılır.

### 3. AutoCAD ASCII `.dxf` Durum Makinesi ve Blok Açılımı ([`dxf-parser.js`](js/parsers/dxf-parser.js))
- Grup kodu / değer çiftleri (`parseDxfPairs`) sırayla taranarak `HEADER` (`$ACADVER`, `$INSUNITS`), `TABLES/LAYER` ve `BLOCKS` bölümleri işlenir.
- `INSERT` nesneleri blok adıyla eşleştirilip konum öteleme, döndürme açısı, ölçek (`sx`, `sy`) ve satır/sütun dizileriyle özyinelemeli olarak açılır. Tekdüze olmayan ölçeklemeye (`sx ≠ sy`) maruz kalan `CIRCLE` ve `ARC` nesneleri geometrik doğruluğu korumak için otomatik olarak poligona/poliline'a örneklenir.
- `LWPOLYLINE` içindeki `42` (bulge) eğrilik katsayıları [`bulgeToArcPoints`](js/core/model.js) yardımcı fonksiyonuyla dairesel yay segmentlerine dönüştürülür.

### 4. Float64 Merkez Kaydırmalı 2B/3B Canvas Motoru ([`renderer.js`](js/core/renderer.js))
Tarayıcı Canvas dönüşüm matrisleri (`ctx.translate` / `ctx.scale`) dahili olarak **32-bit Float** duyarlılığında çalışır. `X = 485.200`, `Y = 4.418.500` gibi büyük UTM koordinatları doğrudan Canvas matrisine verilirse ~0.25–0.5 m mertebesinde yuvarlama titremesi oluşur.
- Bunu önlemek için tüm koordinat dönüşümlerinde **çift duyarlıklı JavaScript `Float64` aritmetiği** kullanılır: ekran koordinatı hesaplanmadan önce dünya koordinatından kameranın merkezi (`wx - cam.cx`, `wy - cam.cy`) çıkarılır ve yalnızca bu küçük göreli fark piksel ölçeğiyle çarpılır.
- **3B Yörünge Modu:** Seçildiğinde her köşe noktası 3B kamera merkezi etrafında Yaw (`azimuth`) ve Pitch (`elevation`) açılarıyla döndürülür, derinlik değerine göre sıralanır (Painter's Algorithm) ve `FACE3D` yüzeyleri gölgelendirilir.

### 5. Uzamsal Izgara İndeksi, Seçim ve OSNAP ([`spatial.js`](js/core/spatial.js))
- Çizim yüklendiğinde çizim sınırları `48 × 48` hücrelik bir **uzamsal ızgara (grid) indeksine** yerleştirilir (`buildSpatialIndex`).
- Fare hareketlerinde yalnızca imleç çevresindeki hücreler sorgulanır; `hitTest` fonksiyonu parça-nokta mesafesi ve kapalı alanlarda ışın dökümü (`pointInPolygon`) ile nesne seçimi yapar. `findSnapPoint` ise köşe (`endpoint`), kenar ortası (`midpoint`) ve yay/çember merkezlerini (`center`) piksel toleransı içinde yakalar.

### 6. Hassas Ölçüm & Tarayıcı İçi Dışa Aktarma ([`model.js`](js/core/model.js), [`exporter.js`](js/core/exporter.js))
- Büyük UTM koordinatlarında Shoelace alan formülündeki felaketli basamak kaybını (catastrophic cancellation) önlemek için poligon köşeleri önce ilk noktaya göre orijine ötelenir (`xi - x0`, `yi - y0`), ardından alan hesaplanır.
- Kullanıcı ekrandaki görünür katmanları tek tıkla **GeoJSON (`FeatureCollection`)**, **DXF (`AC1015`)**, **SVG** veya **PNG** olarak indirebilir.

---

## Dosya Yapısı

```text
cad-ncz-viewer/
├── index.html                      # Ana uygulama arayüzü (CSS Grid çalışma alanı)
├── README.md                       # Proje belgelendirmesi (neler & nasıl yapıldı)
├── LICENSE                         # MIT Lisansı
├── .nojekyll                        # GitHub Pages Jekyll işleme devre dışı bayrağı
├── .gitignore
├── .github/
│   └── workflows/
│       └── deploy-pages.yml        # GitHub Actions ile otomatik Pages dağıtım iş akışı
├── css/
│   └── style.css                   # Arayüz stilleri (Koyu, Antrasit, Açık temalar + mobil çekmeceler)
├── js/
│   ├── main.js                     # Uygulama denetleyicisi, araçlar, ölçüm, kısayollar, I18N
│   ├── core/
│   │   ├── model.js                # Birleşik CAD veri modeli, ACI 256 palet, Float64 alan/uzunluk
│   │   ├── spatial.js              # 48×48 uzamsal ızgara indeksi, hitTest ve CAD OSNAP
│   │   ├── renderer.js             # Float64 merkez kaydırmalı 2B + 3B yörünge Canvas motoru
│   │   └── exporter.js             # GeoJSON, DXF, SVG ve PNG dışa aktarıcıları
│   ├── parsers/
│   │   ├── index.js                # Uzantı yönlendirici (parseCadFile)
│   │   ├── ncz-parser.js           # Netcad ikili TLV (.ncz/.nca) ve ZIP konteyner ayrıştırıcısı
│   │   ├── dxf-parser.js           # AutoCAD ASCII DXF + BLOCKS/INSERT + bulge + SPLINE ayrıştırıcısı
│   │   ├── ncn-parser.js           # Netcad ASCII (.ncn/.xyz/.txt) nokta ayrıştırıcısı
│   │   ├── vector-parser.js        # GeoJSON, KML/KMZ ve SVG ayrıştırıcıları
│   │   └── mesh3d-parser.js        # Wavefront OBJ ve ASCII/Binary STL ayrıştırıcıları
│   └── utils/
│       ├── cp1254.js               # Windows-1254 Türkçe karakter dekoderi
│       └── zip.js                  # Saf JS ZIP okuyucusu (DecompressionStream)
├── samples/
│   ├── generate_samples.py         # Özgün MIT örnek dosyalarını üreten Python betiği
│   ├── ornek_imar_projesi.ncz      # İkili Netcad TLV imar/parselasyon örneği (ITRF96/TM30)
│   ├── ornek_mimari_plan.dxf       # AutoCAD DXF konut kat planı örneği
│   └── ornek_arazi_noktalari.ncn   # Arazi topoğrafya nokta bulutu örneği
└── tests/
    ├── test-runner.html            # Tarayıcı içi görsel test koşucusu
    └── test-suite.js               # 12 birim ve entegrasyon testi
```

---

## Yerel Çalıştırma ve Testler

ES6 modülleri (`import`/`export`) güvenlik politikası (CORS) gereği `file://` protokolü yerine yerel bir HTTP sunucusu üzerinden açılmalıdır:

```bash
# Proje klasöründe yerleşik Python sunucusunu başlatın:
python -m http.server 8080
```

Ardından tarayıcınızda açın:
- **Uygulama:** `http://localhost:8080/`
- **Örnekleri doğrudan URL ile açma:** `http://localhost:8080/?sample=ncz`, `?sample=dxf` veya `?sample=ncn`
- **Otomatik Testler:** `http://localhost:8080/tests/test-runner.html` (NCZ ikili TLV, ZIP konteynerli NCZ, GML, DXF blok/bulge/spline, NCN, GeoJSON, KML, SVG, OBJ/STL, Float64 alan/yay matematiği, uzamsal indeks/OSNAP ve dışa aktarım gidiş-dönüş testleri dahil **12/12** test)

---

## Klavye Kısayolları

| Kısayol | İşlev |
| :--- | :--- |
| `V` | Seçim ve inceleme aracı |
| `H` | Görünümü kaydır (Pan) |
| `M` | Mesafe ölçümü |
| `A` | Kapalı alan ölçümü |
| `S` | OSNAP yakalamayı aç / kapat |
| `G` | Koordinat ızgarasını aç / kapat |
| `3` | 3B Yörünge (Orbit) görünümünü aç / kapat |
| `X` | Y ↔ X eksenlerini değiştir |
| `F` | Tüm çizimi ekrana sığdır |
| `ESC` | Seçimi / ölçümü temizle |

---

## Lisans

Bu proje [MIT Lisansı](LICENSE) altında lisanslanmıştır. Tüm ayrıştırıcılar ve örnek veriler sıfırdan özgün olarak geliştirilmiştir.
