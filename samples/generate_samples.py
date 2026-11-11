#!/usr/bin/env python3
"""
Clean-room sample generator for CAD & Netcad (.ncz) Web Viewer (MIT Licensed).

Generates three 100% original sample files in ./samples/:
  1. ornek_imar_projesi.ncz  - Classic Netcad TLV binary (.ncz) with Tags 1, 2, 6, 14, 21, 22, 25, 28
  2. ornek_mimari_plan.dxf   - AutoCAD ASCII DXF architectural plan with BLOCKS/INSERT, bulges, splines, MTEXT
  3. ornek_arazi_noktalari.ncn - Netcad ASCII survey coordinate file (NoktaNo Y X Z Kod)
"""

import math
import os
import struct

OUT_DIR = os.path.dirname(os.path.abspath(__file__))


def pack_tlv(tag: int, payload: bytes) -> bytes:
    return struct.pack("<BI", tag, len(payload)) + payload


def short_string_cp1254(text: str, max_len: int = 255) -> bytes:
    raw = text.encode("cp1254", errors="replace")[:max_len]
    return bytes([len(raw)]) + raw


def fixed_short_string_cp1254(text: str, total_size: int) -> bytes:
    raw = text.encode("cp1254", errors="replace")[: total_size - 1]
    buf = bytearray(total_size)
    buf[0] = len(raw)
    buf[1 : 1 + len(raw)] = raw
    return bytes(buf)


def build_entity_header(
    geom_type: int,
    layer_idx: int,
    c1: float,
    c2: float,
    z: float,
    min_c1: float,
    min_c2: float,
    max_c1: float,
    max_c2: float,
    flags: int = 0x01,
) -> bytes:
    """Builds the 81-byte (0x51) common Netcad TLV geometry header."""
    buf = bytearray(0x51)
    buf[0] = flags
    buf[1] = geom_type
    buf[2] = layer_idx
    struct.pack_into("<ddf", buf, 3, c1, c2, z)
    struct.pack_into("<dddd", buf, 0x2D, min_c1, min_c2, max_c1, max_c2)
    return bytes(buf)


def make_ncz_point(layer_idx: int, east: float, north: float, z: float, name: str) -> bytes:
    # c1 = Northing, c2 = Easting
    hdr = build_entity_header(1, layer_idx, north, east, z, north, east, north, east)
    body = short_string_cp1254(name, 32)
    return pack_tlv(21, hdr + body)


def make_ncz_line(layer_idx: int, e1: float, n1: float, z1: float, e2: float, n2: float, z2: float) -> bytes:
    hdr = build_entity_header(
        2,
        layer_idx,
        n1,
        e1,
        z1,
        min(n1, n2),
        min(e1, e2),
        max(n1, n2),
        max(e1, e2),
    )
    body = struct.pack("<ddf", n2, e2, z2)
    return pack_tlv(21, hdr + body)


def make_ncz_circle(layer_idx: int, ce: float, cn: float, z: float, r: float) -> bytes:
    hdr = build_entity_header(
        3,
        layer_idx,
        cn,
        ce,
        z,
        cn - r,
        ce - r,
        cn + r,
        ce + r,
    )
    body = struct.pack("<d", r)
    return pack_tlv(21, hdr + body)


def make_ncz_arc(
    layer_idx: int, ce: float, cn: float, z: float, r: float, a1: float, a2: float
) -> bytes:
    hdr = build_entity_header(
        4,
        layer_idx,
        cn,
        ce,
        z,
        cn - r,
        ce - r,
        cn + r,
        ce + r,
    )
    body = struct.pack("<fff", r, a1, a2)
    return pack_tlv(21, hdr + body)


def make_ncz_text(
    layer_idx: int, east: float, north: float, z: float, text: str, height: float, angle: float = 0.0, align: str = "L"
) -> bytes:
    hdr = build_entity_header(5, layer_idx, north, east, z, north, east, north, east)
    body = struct.pack("<ffB", height, angle, ord(align[0])) + b"\x00\x00" + short_string_cp1254(text, 200)
    return pack_tlv(21, hdr + body)


def make_ncz_symbol(
    layer_idx: int, east: float, north: float, z: float, size: float, symbol_id: int, angle: float = 0.0
) -> bytes:
    half = size * 0.5
    hdr = build_entity_header(
        6, layer_idx, north, east, z, north - half, east - half, north + half, east + half
    )
    body = struct.pack("<ffH", size, angle, symbol_id)
    return pack_tlv(21, hdr + body)


def make_ncz_poly(
    layer_idx: int,
    pts_east_north_z,
    closed: bool = True,
    label: str = "",
    db_table: str = "",
    db_key: str = "",
) -> bytes:
    ns = [p[1] for p in pts_east_north_z]
    es = [p[0] for p in pts_east_north_z]
    z0 = pts_east_north_z[0][2] if pts_east_north_z else 0.0
    hdr = build_entity_header(
        7,
        layer_idx,
        ns[0],
        es[0],
        z0,
        min(ns),
        min(es),
        max(ns),
        max(es),
    )

    db_block = b""
    tag = 21
    if db_table or db_key:
        tag = 22
        db_block = fixed_short_string_cp1254(db_table, 12) + fixed_short_string_cp1254(db_key, 16)

    body_hdr = bytearray(27)
    # Optional short label inside body+1..+11
    lbl_bytes = label.encode("cp1254", errors="replace")[:9]
    body_hdr[1] = len(lbl_bytes)
    body_hdr[2 : 2 + len(lbl_bytes)] = lbl_bytes
    body_hdr[15] = 0x01 if closed else 0x00

    verts = bytearray()
    for e, n, z in pts_east_north_z:
        verts += struct.pack("<ddd", n, e, z)

    return pack_tlv(tag, hdr + db_block + bytes(body_hdr) + bytes(verts))


def build_bmp_thumbnail(width: int = 96, height: int = 64) -> bytes:
    """Create an uncompressed 24-bit BMP schematic thumbnail for Tag 14."""
    row_stride = (width * 3 + 3) & ~3
    pixel_size = row_stride * height
    file_size = 54 + pixel_size

    bmp = bytearray(file_size)
    # BITMAPFILEHEADER
    bmp[0:2] = b"BM"
    struct.pack_into("<IHHII", bmp, 2, file_size, 0, 0, 54, 40)
    struct.pack_into("<iiHHIIIIII", bmp, 18, width, height, 1, 24, 0, pixel_size, 2835, 2835, 0, 0)

    def set_px(x: int, y: int, r: int, g: int, b: int):
        if 0 <= x < width and 0 <= y < height:
            # BMP rows are bottom-up, BGR order
            off = 54 + y * row_stride + x * 3
            bmp[off] = b
            bmp[off + 1] = g
            bmp[off + 2] = r

    # Background dark blueprint
    for y in range(height):
        for x in range(width):
            set_px(x, y, 16, 25, 38)
            if x % 16 == 0 or y % 16 == 0:
                set_px(x, y, 28, 42, 60)

    # Parcels in amber
    for px0, px1 in [(10, 42), (48, 84)]:
        for x in range(px0, px1 + 1):
            set_px(x, 12, 234, 179, 8)
            set_px(x, 48, 234, 179, 8)
        for y in range(12, 49):
            set_px(px0, y, 234, 179, 8)
            set_px(px1, y, 234, 179, 8)
            set_px((px0 + px1) // 2, y, 234, 179, 8)

    # Buildings in sky blue
    for bx in range(15, 23):
        for by in range(20, 38):
            set_px(bx, by, 56, 189, 248)
    for bx in range(54, 63):
        for by in range(22, 40):
            set_px(bx, by, 56, 189, 248)

    # Road avenue across bottom
    for x in range(4, width - 4):
        set_px(x, 8, 34, 211, 238)
        set_px(x, 54, 34, 211, 238)

    return bytes(bmp)


def generate_sample_ncz():
    out_path = os.path.join(OUT_DIR, "ornek_imar_projesi.ncz")
    records = []

    # Anchor coordinates in ITRF96 / TM30 (EPSG:5254)
    E0 = 485200.0
    N0 = 4418500.0

    # Tag 1: 120-byte header placeholder (bounds at payload+0x2C..+0x4B)
    hdr1 = bytearray(120)
    struct.pack_into("<dddd", hdr1, 0x2C, N0 - 20.0, E0 - 20.0, N0 + 180.0, E0 + 240.0)
    records.append(pack_tlv(1, bytes(hdr1)))

    # Tag 25: Version
    records.append(pack_tlv(25, short_string_cp1254("5.2.0.1000-SAMPLE", 64)))

    # Tag 2: User / Project author
    records.append(pack_tlv(2, short_string_cp1254("CAD & NCZ Görüntüleyici Örnek Veri", 64)))

    # Tag 6: Layer table (9-byte header + N * 29-byte layer entries)
    layers = [
        ("0", 7, 1, 0x40),
        ("ADA_SINIRI", 1, 1, 0x40),
        ("PARSEL", 2, 1, 0x40),
        ("BINA", 5, 1, 0x40),
        ("YOL_EKSENI", 4, 2, 0x40),
        ("ALTYAPI_HAT", 3, 1, 0x40),
        ("KOT_NOKTA", 6, 1, 0x40),
        ("PAFTA_KARELAJ", 8, 1, 0x40),
        ("YAZI", 7, 1, 0x40),
        ("SEMBOL", 30, 1, 0x40),
    ]
    tag6_hdr = bytearray(9)
    struct.pack_into("<H", tag6_hdr, 0, len(layers))
    tag6_body = bytearray(tag6_hdr)
    for name, aci, lt, flg in layers:
        rec = bytearray(29)
        struct.pack_into("<HHi", rec, 0, aci, lt, flg)
        enc = name.encode("cp1254", errors="replace")[:20]
        rec[8] = len(enc)
        rec[9 : 9 + len(enc)] = enc
        tag6_body += rec
    records.append(pack_tlv(6, bytes(tag6_body)))

    # Tag 14: Embedded BMP Thumbnail
    records.append(pack_tlv(14, build_bmp_thumbnail(96, 64)))

    # Tag 28: Reference System XML
    ref_hdr = fixed_short_string_cp1254("REF", 11)
    ref_xml = (
        "<ReferenceSystem><DatumName>ITRF96 / TM30</DatumName>"
        "<ProjectionName>Transverse Mercator 3 deg</ProjectionName>"
        "<EPSG>5254</EPSG></ReferenceSystem>"
    ).encode("cp1254")
    records.append(pack_tlv(28, ref_hdr + ref_xml))

    # --- Layer 7: PAFTA_KARELAJ grid crosses & labels ---
    for gx in range(0, 241, 50):
        for gy in range(0, 181, 50):
            e = E0 + gx
            n = N0 + gy
            records.append(make_ncz_line(7, e - 3.0, n, 0.0, e + 3.0, n, 0.0))
            records.append(make_ncz_line(7, e, n - 3.0, 0.0, e, n + 3.0, 0.0))
            if gx in (0, 200) or gy == 0:
                records.append(make_ncz_text(7, e + 2.0, n + 2.0, 0.0, f"{n:.0f}/{e:.0f}", 2.1, 0.0))

    # --- Layer 4: YOL_EKSENI avenue & side street ---
    # South main avenue (Cumhuriyet Caddesi, 15m wide)
    records.append(make_ncz_poly(4, [(E0 - 15, N0 + 18, 941.2), (E0 + 235, N0 + 18, 942.8)], closed=False))
    records.append(make_ncz_poly(4, [(E0 - 15, N0 + 3.0, 941.0), (E0 + 235, N0 + 3.0, 942.5)], closed=False))
    # Middle street between Ada 101 and Ada 102
    records.append(make_ncz_poly(4, [(E0 + 114, N0 + 18, 942.0), (E0 + 114, N0 + 165, 944.5)], closed=False))
    records.append(make_ncz_poly(4, [(E0 + 126, N0 + 18, 942.1), (E0 + 126, N0 + 165, 944.6)], closed=False))
    # North boundary road
    records.append(make_ncz_poly(4, [(E0 - 15, N0 + 150, 944.0), (E0 + 235, N0 + 150, 945.2)], closed=False))
    # Street intersection fillets & roundabout arc
    records.append(make_ncz_circle(4, E0 + 120, N0 + 10.5, 941.8, 5.2))
    records.append(make_ncz_arc(4, E0 + 109, N0 + 23, 942.0, 5.0, 1.5 * math.pi, 2.0 * math.pi))
    records.append(make_ncz_arc(4, E0 + 131, N0 + 23, 942.0, 5.0, math.pi, 1.5 * math.pi))

    # --- Layer 1: ADA_SINIRI (Blocks 101 and 102) ---
    ada101 = [(E0 + 10, N0 + 23, 942.0), (E0 + 109, N0 + 23, 942.4), (E0 + 109, N0 + 145, 944.2), (E0 + 10, N0 + 145, 943.8)]
    ada102 = [(E0 + 131, N0 + 23, 942.2), (E0 + 221, N0 + 23, 942.9), (E0 + 221, N0 + 145, 944.8), (E0 + 131, N0 + 145, 944.4)]
    records.append(make_ncz_poly(1, ada101, closed=True, label="ADA 101", db_table="VT_ADA", db_key="101"))
    records.append(make_ncz_poly(1, ada102, closed=True, label="ADA 102", db_table="VT_ADA", db_key="102"))

    # --- Layer 2: PARSEL (6 parcels in Ada 101 + 4 parcels in Ada 102) ---
    parsels_101 = [
        ("101/1", E0 + 10, E0 + 43, N0 + 23, N0 + 84),
        ("101/2", E0 + 43, E0 + 76, N0 + 23, N0 + 84),
        ("101/3", E0 + 76, E0 + 109, N0 + 23, N0 + 84),
        ("101/4", E0 + 10, E0 + 43, N0 + 84, N0 + 145),
        ("101/5", E0 + 43, E0 + 76, N0 + 84, N0 + 145),
        ("101/6", E0 + 76, E0 + 109, N0 + 84, N0 + 145),
    ]
    for pkey, x0, x1, y0, y1 in parsels_101:
        poly = [(x0, y0, 943.0), (x1, y0, 943.0), (x1, y1, 943.5), (x0, y1, 943.5)]
        records.append(make_ncz_poly(2, poly, closed=True, label=pkey, db_table="VT_PARSEL", db_key=pkey))
        records.append(make_ncz_text(8, (x0 + x1) * 0.5 - 6, y0 + 8, 943.0, pkey, 2.8, 0.0))

    parsels_102 = [
        ("102/1", E0 + 131, E0 + 176, N0 + 23, N0 + 84),
        ("102/2", E0 + 176, E0 + 221, N0 + 23, N0 + 84),
        ("102/3", E0 + 131, E0 + 221, N0 + 84, N0 + 145),  # Park & Social Facility parcel
    ]
    for pkey, x0, x1, y0, y1 in parsels_102:
        poly = [(x0, y0, 943.2), (x1, y0, 943.2), (x1, y1, 943.8), (x0, y1, 943.8)]
        records.append(make_ncz_poly(2, poly, closed=True, label=pkey, db_table="VT_PARSEL", db_key=pkey))
        records.append(make_ncz_text(8, (x0 + x1) * 0.5 - 7, y0 + 8, 943.2, pkey, 2.8, 0.0))

    # --- Layer 3: BINA (Building footprints inside parcels) ---
    buildings = [
        ("B-101/1", E0 + 17, E0 + 36, N0 + 38, N0 + 68, 956.5),
        ("B-101/2", E0 + 50, E0 + 69, N0 + 38, N0 + 68, 956.5),
        ("B-101/3", E0 + 83, E0 + 102, N0 + 38, N0 + 68, 956.5),
        ("B-101/4", E0 + 17, E0 + 36, N0 + 98, N0 + 128, 959.0),
        ("B-101/5", E0 + 50, E0 + 69, N0 + 98, N0 + 128, 959.0),
        ("B-101/6", E0 + 83, E0 + 102, N0 + 98, N0 + 128, 959.0),
        ("B-102/1", E0 + 140, E0 + 167, N0 + 36, N0 + 66, 958.0),
        ("B-102/2", E0 + 185, E0 + 212, N0 + 36, N0 + 66, 958.0),
    ]
    for bkey, x0, x1, y0, y1, roof_z in buildings:
        bpoly = [(x0, y0, roof_z), (x1, y0, roof_z), (x1, y1, roof_z), (x0, y1, roof_z)]
        records.append(make_ncz_poly(3, bpoly, closed=True, label=bkey, db_table="VT_BINA", db_key=bkey))
        records.append(make_ncz_text(8, (x0 + x1) * 0.5 - 5, (y0 + y1) * 0.5 - 1, roof_z, "B+4", 2.4, 0.0))

    # --- Layer 5: ALTYAPI_HAT (Drainage pipeline & inspection manholes) ---
    pipe_pts = [
        (E0 - 10, N0 + 10.5, 938.2),
        (E0 + 60, N0 + 10.5, 938.5),
        (E0 + 120, N0 + 10.5, 938.8),
        (E0 + 230, N0 + 10.5, 939.4),
    ]
    records.append(make_ncz_poly(5, pipe_pts, closed=False))
    branch_pts = [
        (E0 + 120, N0 + 10.5, 938.8),
        (E0 + 120, N0 + 84, 939.7),
        (E0 + 120, N0 + 158, 940.6),
    ]
    records.append(make_ncz_poly(5, branch_pts, closed=False))
    for mx, my, mz in [(E0 + 10, N0 + 10.5, 938.3), (E0 + 60, N0 + 10.5, 938.5), (E0 + 180, N0 + 10.5, 939.1), (E0 + 120, N0 + 84, 939.7)]:
        records.append(make_ncz_circle(5, mx, my, mz, 1.3))

    # --- Layer 6: KOT_NOKTA (Survey elevation benchmarks) ---
    survey_pts = [
        ("N1", E0 + 10, N0 + 23, 942.05),
        ("N2", E0 + 109, N0 + 23, 942.42),
        ("N3", E0 + 109, N0 + 145, 944.18),
        ("N4", E0 + 10, N0 + 145, 943.76),
        ("N5", E0 + 131, N0 + 23, 942.20),
        ("N6", E0 + 221, N0 + 23, 942.88),
        ("N7", E0 + 221, N0 + 145, 944.82),
        ("N8", E0 + 131, N0 + 145, 944.40),
        ("PL10", E0 + 120, N0 + 10.5, 941.80),
        ("PL11", E0 + 120, N0 + 145, 944.32),
    ]
    for pname, pe, pn, pz in survey_pts:
        records.append(make_ncz_point(6, pe, pn, pz, pname))

    # --- Layer 9: SEMBOL (Trees in park parcel 102/3 & street lighting) ---
    for i, sx in enumerate(range(142, 215, 16)):
        records.append(make_ncz_symbol(9, E0 + sx, N0 + 112, 944.1, 4.5, 10 + (i % 3)))
        records.append(make_ncz_symbol(9, E0 + sx, N0 + 132, 944.5, 4.0, 12))
    # North arrow symbol in top-right
    records.append(make_ncz_symbol(9, E0 + 230, N0 + 162, 945.0, 9.0, 1, 0.0))

    # --- Layer 8: YAZI (Turkish labels, including angled road label) ---
    records.append(make_ncz_text(8, E0 + 25, N0 + 158, 944.2, "ÖRNEK İMAR VE PARSELASYON PLANI (Ölçek 1/1000)", 3.8, 0.0))
    records.append(make_ncz_text(8, E0 + 40, N0 + 8.5, 941.4, "CUMHURİYET CADDESİ (15.00 m)", 3.2, 0.0))
    records.append(make_ncz_text(8, E0 + 122.5, N0 + 62, 943.2, "GÜLBAHÇE SOKAK (12.00 m)", 2.8, math.pi / 2.0))
    records.append(make_ncz_text(8, E0 + 150, N0 + 104, 944.0, "YEŞİL ALAN & PARK", 3.4, 0.0))
    records.append(make_ncz_text(8, E0 + 48, N0 + 135, 943.8, "ADA: 101 (Konut Alanı E=1.50)", 2.6, 0.0))
    records.append(make_ncz_text(8, E0 + 152, N0 + 73, 943.4, "ADA: 102 (Ticari + Park)", 2.6, 0.0))

    with open(out_path, "wb") as f:
        for rec in records:
            f.write(rec)

    print(f"Generated {out_path} ({os.path.getsize(out_path)} bytes, {len(records)} TLV records)")


def generate_sample_dxf():
    out_path = os.path.join(OUT_DIR, "ornek_mimari_plan.dxf")
    lines = []

    def add(code, val):
        lines.append(str(code))
        lines.append(str(val))

    # HEADER
    add(0, "SECTION")
    add(2, "HEADER")
    add(9, "$ACADVER")
    add(1, "AC1024")
    add(9, "$INSUNITS")
    add(70, 6)  # Meters
    add(9, "$EXTMIN")
    add(10, -2.0)
    add(20, -2.0)
    add(30, 0.0)
    add(9, "$EXTMAX")
    add(10, 18.0)
    add(20, 14.0)
    add(30, 0.0)
    add(0, "ENDSEC")

    # TABLES / LAYER
    add(0, "SECTION")
    add(2, "TABLES")
    add(0, "TABLE")
    add(2, "LAYER")
    layers = [
        ("0", 7),
        ("DUVARLAR", 7),
        ("KAPLAMA_BALKON", 4),
        ("DOGRAMA_KAPI", 2),
        ("MOBILYA", 30),
        ("KOLONLAR", 1),
        ("PEYZAJ", 3),
        ("METIN_OLCU", 6),
    ]
    add(70, len(layers))
    for lname, aci in layers:
        add(0, "LAYER")
        add(2, lname)
        add(70, 0)
        add(62, aci)
        add(6, "CONTINUOUS")
    add(0, "ENDTAB")
    add(0, "ENDSEC")

    # BLOCKS: KAPI_90 (door swing block) & KOLTUK (armchair block)
    add(0, "SECTION")
    add(2, "BLOCKS")
    # Block 1: KAPI_90
    add(0, "BLOCK")
    add(8, "0")
    add(2, "KAPI_90")
    add(70, 0)
    add(10, 0.0)
    add(20, 0.0)
    add(30, 0.0)
    # Door leaf line
    add(0, "LINE")
    add(8, "DOGRAMA_KAPI")
    add(10, 0.0)
    add(20, 0.0)
    add(11, 0.0)
    add(21, 0.90)
    # Door swing arc
    add(0, "ARC")
    add(8, "DOGRAMA_KAPI")
    add(10, 0.0)
    add(20, 0.0)
    add(40, 0.90)
    add(50, 0.0)
    add(51, 90.0)
    add(0, "ENDBLK")

    # Block 2: MASA_SANDALYE
    add(0, "BLOCK")
    add(8, "0")
    add(2, "MASA_TAKIM")
    add(70, 0)
    add(10, 0.0)
    add(20, 0.0)
    add(30, 0.0)
    add(0, "LWPOLYLINE")
    add(8, "MOBILYA")
    add(90, 4)
    add(70, 1)
    for px, py in [(-0.9, -0.5), (0.9, -0.5), (0.9, 0.5), (-0.9, 0.5)]:
        add(10, px)
        add(20, py)
    # 4 chairs
    for cx, cy in [(-0.45, -0.78), (0.45, -0.78), (-0.45, 0.78), (0.45, 0.78)]:
        add(0, "CIRCLE")
        add(8, "MOBILYA")
        add(10, cx)
        add(20, cy)
        add(40, 0.20)
    add(0, "ENDBLK")
    add(0, "ENDSEC")

    # Helper functions for entities
    def lwpoly(layer, pts, closed=True):
        add(0, "LWPOLYLINE")
        add(8, layer)
        add(90, len(pts))
        add(70, 1 if closed else 0)
        for p in pts:
            add(10, p[0])
            add(20, p[1])
            if len(p) > 2 and p[2] != 0.0:
                add(42, p[2])

    # ENTITIES
    add(0, "SECTION")
    add(2, "ENTITIES")

    # Outer building shell (14.0m x 10.0m)
    lwpoly("DUVARLAR", [(0.0, 0.0), (14.0, 0.0), (14.0, 10.0), (0.0, 10.0)], True)
    lwpoly("DUVARLAR", [(0.25, 0.25), (13.75, 0.25), (13.75, 9.75), (0.25, 9.75)], True)

    # Interior room partitions (Salon | Kitchen | Bedroom | Entry/Bath)
    lwpoly("DUVARLAR", [(6.2, 0.25), (6.2, 9.75)], False)
    lwpoly("DUVARLAR", [(6.2, 5.2), (13.75, 5.2)], False)
    lwpoly("DUVARLAR", [(9.8, 0.25), (9.8, 5.2)], False)
    lwpoly("DUVARLAR", [(9.8, 5.2), (9.8, 9.75)], False)

    # Semi-circular / arched balcony on West side using LWPOLYLINE bulge = -0.55 (curves outward West)
    lwpoly("KAPLAMA_BALKON", [(0.0, 2.2), (-2.2, 2.2, -0.55), (-2.2, 7.8), (0.0, 7.8)], False)

    # Structural reinforced concrete columns (KOLONLAR)
    for cx, cy in [
        (0.15, 0.15), (6.2, 0.15), (9.8, 0.15), (13.85, 0.15),
        (0.15, 5.2), (6.2, 5.2), (9.8, 5.2), (13.85, 5.2),
        (0.15, 9.85), (6.2, 9.85), (9.8, 9.85), (13.85, 9.85),
    ]:
        lwpoly("KOLONLAR", [(cx - 0.18, cy - 0.18), (cx + 0.18, cy - 0.18), (cx + 0.18, cy + 0.18), (cx - 0.18, cy + 0.18)], True)

    # Doors via INSERT of KAPI_90
    for ix, iy, rot, sx in [
        (7.2, 0.25, 0.0, 1.0),     # Main entrance
        (6.2, 3.8, 90.0, 1.0),     # Hall -> Salon
        (6.2, 6.4, 270.0, 0.9),    # Hall -> Bedroom
        (10.8, 5.2, 0.0, 0.9),     # Hall -> Bedroom
        (0.25, 4.5, 270.0, 1.0),   # Salon -> Balcony
    ]:
        add(0, "INSERT")
        add(8, "DOGRAMA_KAPI")
        add(2, "KAPI_90")
        add(10, ix)
        add(20, iy)
        add(30, 0.0)
        add(41, sx)
        add(42, 1.0)
        add(50, rot)

    # Dining table INSERT
    add(0, "INSERT")
    add(8, "MOBILYA")
    add(2, "MASA_TAKIM")
    add(10, 3.1)
    add(20, 7.2)
    add(41, 1.15)
    add(42, 1.0)
    add(50, 0.0)

    # L-sofa in Salon
    lwpoly("MOBILYA", [(1.0, 1.2), (4.6, 1.2), (4.6, 2.2), (2.0, 2.2), (2.0, 4.2), (1.0, 4.2)], True)
    # Coffee table ellipse
    add(0, "ELLIPSE")
    add(8, "MOBILYA")
    add(10, 3.3)
    add(20, 3.3)
    add(11, 0.75)
    add(21, 0.0)
    add(40, 0.55)
    add(41, 0.0)
    add(42, 6.283185307)

    # Double bed in Yatak Odası
    lwpoly("MOBILYA", [(10.8, 6.4), (13.0, 6.4), (13.0, 8.6), (10.8, 8.6)], True)
    # Kitchen counter
    lwpoly("MOBILYA", [(6.4, 9.0), (9.6, 9.0), (9.6, 9.65), (6.4, 9.65)], True)

    # Exterior garden pathway SPLINE (fit points)
    add(0, "SPLINE")
    add(8, "PEYZAJ")
    add(70, 8)
    add(71, 3)
    for px, py in [(7.2, 0.0), (7.6, -1.1), (9.4, -1.9), (12.2, -1.7), (15.2, -0.8)]:
        add(11, px)
        add(21, py)
        add(31, 0.0)

    # Landscaping tree circles outside
    for tx, ty, tr in [(15.6, 2.5, 1.05), (15.8, 7.2, 1.25), (-1.4, -0.8, 0.95)]:
        add(0, "CIRCLE")
        add(8, "PEYZAJ")
        add(10, tx)
        add(20, ty)
        add(40, tr)

    # Room Labels (TEXT & MTEXT)
    add(0, "MTEXT")
    add(8, "METIN_OLCU")
    add(10, 2.3)
    add(20, 5.3)
    add(40, 0.38)
    add(1, "SALON\\P28.40 m²")

    for lx, ly, txt in [
        (7.2, 7.4, "MUTFAK (14.20 m²)"),
        (10.7, 9.1, "YATAK ODASI"),
        (7.2, 2.6, "ANTRE & HOL"),
        (10.8, 2.6, "BANYO & WC"),
        (-2.9, 5.0, "BALKON"),
        (0.2, 10.7, "ZEMİN KAT MİMARİ PLAN ÖRNEĞİ (DXF)"),
    ]:
        add(0, "TEXT")
        add(8, "METIN_OLCU")
        add(10, lx)
        add(20, ly)
        add(40, 0.30)
        add(1, txt)

    add(0, "ENDSEC")
    add(0, "EOF")

    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")

    print(f"Generated {out_path} ({os.path.getsize(out_path)} bytes)")


def generate_sample_ncn():
    out_path = os.path.join(OUT_DIR, "ornek_arazi_noktalari.ncn")
    rows = []

    # Benchmarks (PL)
    benchmarks = [
        ("PL100", 485110.240, 4418510.120, 941.450, "POLIGON"),
        ("PL101", 485185.620, 4418522.480, 942.180, "POLIGON"),
        ("PL102", 485240.150, 4418580.910, 943.720, "POLIGON"),
        ("PL103", 485140.890, 4418595.340, 944.050, "POLIGON"),
    ]
    rows.extend(benchmarks)

    # Road centerline & curbs along curving hillside route
    for i in range(1, 13):
        t = (i - 1) / 11.0
        y = 485105.0 + t * 145.0
        x = 4418530.0 + 18.0 * math.sin(t * math.pi * 0.8) + t * 32.0
        z = 941.20 + t * 2.85
        rows.append((f"YE{i}", round(y, 3), round(x, 3), round(z, 3), "YOL_EKSENI"))
        rows.append((f"YS{i}", round(y - 3.5, 3), round(x + 3.5, 3), round(z - 0.08, 3), "BORDUR_SOL"))
        rows.append((f"YG{i}", round(y + 3.5, 3), round(x - 3.5, 3), round(z + 0.08, 3), "BORDUR_SAG"))

    # Parcel corner points
    parcel_pts = [
        ("PK1", 485125.00, 4418555.00, 942.85, "PARSEL_KOSE"),
        ("PK2", 485165.00, 4418558.50, 943.10, "PARSEL_KOSE"),
        ("PK3", 485162.50, 4418592.00, 943.95, "PARSEL_KOSE"),
        ("PK4", 485122.00, 4418588.50, 943.70, "PARSEL_KOSE"),
        ("PK5", 485178.00, 4418562.00, 943.25, "BINA_KOSE"),
        ("PK6", 485196.00, 4418564.00, 943.40, "BINA_KOSE"),
        ("PK7", 485194.00, 4418582.00, 943.80, "BINA_KOSE"),
        ("PK8", 485176.00, 4418580.00, 943.65, "BINA_KOSE"),
    ]
    rows.extend(parcel_pts)

    # Retaining wall & trees
    for i in range(1, 7):
        rows.append((f"IST{i}", round(485118.0 + i * 15.5, 3), round(4418602.0 + i * 1.4, 3), round(944.1 + i * 0.15, 3), "ISTINAT_DUVARI"))
    for i in range(1, 9):
        rows.append((f"AG{i}", round(485130.0 + (i % 4) * 28.0, 3), round(4418542.0 + (i // 5) * 44.0, 3), round(942.6 + i * 0.2, 3), "AGAC"))

    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        for pid, y, x, z, code in rows:
            f.write(f"{pid:<8} {y:11.3f} {x:11.3f} {z:8.3f} {code}\n")

    print(f"Generated {out_path} ({os.path.getsize(out_path)} bytes, {len(rows)} points)")


if __name__ == "__main__":
    generate_sample_ncz()
    generate_sample_dxf()
    generate_sample_ncn()
