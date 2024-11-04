// generate_sdf.ts
import * as fs from "fs";
import * as path from "path";
import * as THREE from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { fileURLToPath } from "url";
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";

// Node.js の __dirname と __filename を取得
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// three-mesh-bvh の acceleratedRaycast を有効化
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// 即時実行関数で async/await を使用
(async () => {
  try {
    const glbPath = path.resolve(__dirname, "../public/model/sandglass.glb"); // GLBファイルのパスを指定
    const outputPath = path.resolve(
      __dirname,
      "../public/sdf/sandglass_sdf.json"
    ); // 出力するSDFデータのパス

    console.log(`GLBファイルを読み込み中: ${glbPath}`);

    // GLBファイルの読み込み
    const loader = new GLTFLoader();

    // ファイルを読み込んで ArrayBuffer として取得
    const arrayBuffer = fs.readFileSync(glbPath).buffer;

    // GLBファイルをパース
    const gltf: GLTF = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(
        arrayBuffer,
        "",
        (gltf) => resolve(gltf),
        (error) => reject(error)
      );
    });

    console.log("GLBファイルのパースに成功しました。");

    const scene = gltf.scene;

    // ワールド行列を更新
    scene.updateMatrixWorld(true);

    let innerMesh: THREE.Mesh = undefined!;

    // "inner" メッシュを検索
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && child.name === "inner") {
        innerMesh = child as THREE.Mesh;
      }
    });

    if (!innerMesh) {
      console.error('メッシュ "inner" が見つかりませんでした。');
      return;
    }

    console.log('"inner" メッシュを見つけました。');

    // メッシュのワールド行列を適用したジオメトリをクローン
    let transformedGeometry = innerMesh.geometry.clone();

    // ジオメトリにメッシュのワールド行列を適用
    transformedGeometry.applyMatrix4(innerMesh.matrixWorld);

    // ジオメトリがインデックスを持っていることを確認
    if (!transformedGeometry.index) {
      transformedGeometry =
        BufferGeometryUtils.mergeVertices(transformedGeometry);
    }

    // 法線を再計算（変換後のジオメトリに対して必要）
    transformedGeometry.computeVertexNormals();

    console.log("ジオメトリの変換と法線の再計算を完了しました。");

    // SDFの生成
    const sdfSize = 128; // 必要に応じて解像度を調整
    console.log(`SDFの解像度を設定しました: ${sdfSize}`);

    const sdfData = await createSDF(transformedGeometry, sdfSize);

    console.log("SDFの生成が完了しました。");

    // ジオメトリのバウンディングボックスを計算
    transformedGeometry.computeBoundingBox();
    const box = transformedGeometry.boundingBox!;

    const sdfJson = {
      size: sdfSize,
      min: [box.min.x, box.min.y, box.min.z],
      max: [box.max.x, box.max.y, box.max.z],
      data: Array.from(sdfData),
    };

    // 出力ディレクトリが存在しない場合は作成
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`出力ディレクトリを作成しました: ${outputDir}`);
    }

    // SDFデータをJSONファイルに保存
    fs.writeFileSync(outputPath, JSON.stringify(sdfJson));
    console.log("SDFデータを保存しました:", outputPath);
  } catch (error) {
    console.error("エラーが発生しました:", error);
  }
})();

// メッシュからSDFを生成する関数
async function createSDF(
  geometry: THREE.BufferGeometry,
  size: number
): Promise<Float32Array> {
  // SDFの生成
  const sdfData = new Float32Array(size * size * size);

  // AABBを取得
  geometry.computeBoundingBox();
  const boundingBox = geometry.boundingBox!;
  const min = boundingBox.min.clone();
  const max = boundingBox.max.clone();

  console.log("ジオメトリのバウンディングボックスを計算しました:");
  console.log(`Min: (${min.x}, ${min.y}, ${min.z})`);
  console.log(`Max: (${max.x}, ${max.y}, ${max.z})`);

  const delta = new THREE.Vector3(
    (max.x - min.x) / size,
    (max.y - min.y) / size,
    (max.z - min.z) / size
  );

  console.log("SDFグリッドのセルサイズを計算しました:");
  console.log(`Delta: (${delta.x}, ${delta.y}, ${delta.z})`);

  // メッシュのBVHを構築
  console.log("BVHを構築中...");
  const bvh = new MeshBVH(geometry);
  geometry.boundsTree = bvh; // boundsTree を設定
  console.log("BVHの構築が完了しました。");

  // 一時的なメッシュを作成（レイキャスト用）
  const tempMesh = new THREE.Mesh(geometry);

  // Raycasterをセットアップ
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = false; // 全てのヒットを考慮

  // レイの方向を定義
  const directions = [
    new THREE.Vector3(1, 0, 0), // +X
    new THREE.Vector3(-1, 0, 0), // -X
    new THREE.Vector3(0, 1, 0), // +Y
    new THREE.Vector3(0, -1, 0), // -Y
    new THREE.Vector3(0, 0, 1), // +Z
    new THREE.Vector3(0, 0, -1), // -Z
  ];

  // 各ボクセルについて距離を計算
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = x + y * size + z * size * size;

        const point = new THREE.Vector3(
          min.x + (x + 0.5) * delta.x,
          min.y + (y + 0.5) * delta.y,
          min.z + (z + 0.5) * delta.z
        );

        // 点からの最短距離を計算
        const distance = getSignedDistance(
          point,
          geometry,
          bvh,
          raycaster,
          tempMesh,
          directions
        );
        sdfData[idx] = distance;
      }
    }
    console.log(`SDF計算中... ${((z / size) * 100).toFixed(2)}%`);
  }

  return sdfData;
}

// 点からメッシュまでの符号付き距離を計算する関数
function getSignedDistance(
  point: THREE.Vector3,
  geometry: THREE.BufferGeometry,
  bvh: MeshBVH,
  raycaster: THREE.Raycaster,
  tempMesh: THREE.Mesh,
  directions: THREE.Vector3[]
): number {
  // 点からの最短距離を計算
  const hit: {
    point: THREE.Vector3;
    distance: number;
    faceIndex: number;
  } = {
    point: new THREE.Vector3(),
    distance: Infinity,
    faceIndex: -1,
  };

  bvh.closestPointToPoint(point, hit);

  const distance = hit.distance;

  // 複数のレイで内外判定を行う
  let totalIntersections = 0;

  for (const dir of directions) {
    raycaster.set(point, dir);
    const intersects = raycaster.intersectObject(tempMesh, true);
    totalIntersections += intersects.length;
  }

  // 総交差数が偶数なら外側、奇数なら内側
  const isInside = totalIntersections % 2 === 1;

  const sign = isInside ? -1 : 1;

  return distance * sign;
}
