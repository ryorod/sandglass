import bpy
import json
import mathutils
from mathutils import Vector
import bmesh

def distance_point_to_triangle(p, a, b, c):
    """
    点 p から三角形 abc への最短距離を計算します。
    """
    # ベクトルの計算
    ab = b - a
    ac = c - a
    ap = p - a

    # ドット積の計算
    d1 = ab.dot(ap)
    d2 = ac.dot(ap)

    # 領域1
    if d1 <= 0 and d2 <= 0:
        return (p - a).length

    # 領域2
    bp = p - b
    d3 = ab.dot(bp)
    d4 = ac.dot(bp)
    if d3 >= 0 and d4 <= d3:
        return (p - b).length

    # 領域3
    vc = d1 * d4 - d3 * d2
    if vc <= 0 and d1 >= 0 and d3 <= 0:
        v = d1 / (d1 - d3)
        projection = a + ab * v
        return (p - projection).length

    # 領域4
    cp = p - c
    d5 = ab.dot(cp)
    d6 = ac.dot(cp)
    if d6 >= 0 and d5 <= d6:
        return (p - c).length

    # 領域5
    vb = d5 * d2 - d1 * d6
    if vb <= 0 and d2 >= 0 and d6 <= 0:
        w = d2 / (d2 - d6)
        projection = a + ac * w
        return (p - projection).length

    # 領域6
    va = d3 * d6 - d5 * d4
    if va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0:
        return (p - c).length

    # 境界上にある場合
    denom = ab.cross(ac).length
    if denom == 0:
        return (p - a).length  # 三角形が退化している場合
    return abs((p - a).dot(ab.cross(ac))) / denom

def compute_sdf(obj, grid_size=30, padding=1.0):
    # メッシュのバウンディングボックスを取得
    bbox_corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    min_corner = Vector((min([v.x for v in bbox_corners]),
                         min([v.y for v in bbox_corners]),
                         min([v.z for v in bbox_corners])))
    max_corner = Vector((max([v.x for v in bbox_corners]),
                         max([v.y for v in bbox_corners]),
                         max([v.z for v in bbox_corners])))

    # パディングを追加
    min_corner -= Vector((padding, padding, padding))
    max_corner += Vector((padding, padding, padding))

    # グリッドのステップサイズを計算
    step = (max_corner - min_corner) / grid_size

    # SDFデータを格納する辞書
    sdf_data = {
        'size': grid_size,
        'min': [min_corner.x, min_corner.y, min_corner.z],
        'max': [max_corner.x, max_corner.y, max_corner.z],
        'data': []
    }

    # メッシュの三角形リストを作成
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    # メッシュを三角形化
    bmesh.ops.triangulate(bm, faces=bm.faces)

    triangles = []
    for face in bm.faces:
        if len(face.verts) == 3:
            tri = [v.co.copy() for v in face.verts]
            # ワールド座標に変換
            tri_world = [obj.matrix_world @ v for v in tri]
            triangles.append(tri_world)
    bm.free()

    # 関数：ポイントがメッシュの内部かどうかを判定
    def is_inside(point):
        ray_origin = point
        ray_direction = Vector((1.0, 0.0, 0.0))
        hit_count = 0
        for tri in triangles:
            intersect = mathutils.geometry.intersect_ray_tri(
                ray_origin, ray_direction, tri[0], tri[1], tri[2]
            )
            if intersect is not None:
                hit_count += 1
        return hit_count % 2 == 1  # 奇数なら内部

    # グリッドポイントを走査
    total_points = grid_size ** 3
    current_point = 0
    print("SDFの計算を開始します...")
    for x in range(grid_size):
        for y in range(grid_size):
            for z in range(grid_size):
                point = min_corner + Vector((x + 0.5, y + 0.5, z + 0.5)) * step
                # 最近傍の距離を計算
                min_dist = float('inf')
                for tri in triangles:
                    dist = distance_point_to_triangle(point, tri[0], tri[1], tri[2])
                    if dist < min_dist:
                        min_dist = dist
                # インサイドかアウトサイドかを判定
                inside = is_inside(point)
                signed_dist = -min_dist if inside else min_dist
                sdf_data['data'].append(signed_dist)

                # 進捗表示
                current_point += 1
                if current_point % (total_points // 10) == 0:
                    print(f"進捗: {current_point / total_points * 100:.1f}%")

    print("SDFの計算が完了しました。")
    return sdf_data

def export_sdf_to_json(sdf_data, filepath):
    with open(filepath, 'w') as f:
        json.dump(sdf_data, f, indent=4)
    print(f"SDFデータを{filepath}にエクスポートしました。")

def main():
    # アクティブオブジェクトを取得
    obj = bpy.context.active_object
    if obj is None or obj.type != 'MESH':
        print("メッシュオブジェクトを選択してください。")
        return

    # グリッドサイズを設定
    grid_size = 30  # 必要に応じて調整してください（デフォルト: 30）

    # SDFを計算
    sdf_data = compute_sdf(obj, grid_size=grid_size, padding=1.0)

    # ファイルパスを設定
    filepath = bpy.path.abspath("//sdf_output.json")
    export_sdf_to_json(sdf_data, filepath)

if __name__ == "__main__":
    main()
