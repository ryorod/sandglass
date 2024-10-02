// generate_sdf.ts
import * as fs from "fs";
import * as path from "path";
import * as THREE from "three";
import { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HitPointInfo, MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// three-mesh-bvh の acceleratedRaycast を有効化
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// 即時実行関数で async/await を使用
(async () => {
  const glbPath = path.resolve(__dirname, "../public/model/sandglass.glb"); // GLBファイルのパスを指定
  const outputPath = path.resolve(
    __dirname,
    "../public/sdf/sandglass_sdf.json"
  ); // 出力するSDFデータのパス

  // GLBファイルの読み込み
  const loader = new GLTFLoader();

  // ファイルを読み込んで ArrayBuffer として取得
  const arrayBuffer = fs.readFileSync(glbPath).buffer;

  // GLBファイルをパース
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    loader.parse(
      arrayBuffer,
      "",
      (gltf) => resolve(gltf),
      (error) => reject(error)
    );
  });

  const scene = gltf.scene;

  let innerMesh: THREE.Mesh | null = null;

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

  // SDFの生成
  const sdfSize = 64; // 必要に応じて解像度を調整
  const sdfData = await createSDF(innerMesh, sdfSize);

  // SDFデータをJSONファイルに保存
  const boundingBox = (innerMesh as THREE.Mesh).geometry.boundingBox!;
  const sdfJson = {
    size: sdfSize,
    min: boundingBox.min.toArray(),
    max: boundingBox.max.toArray(),
    data: Array.from(sdfData),
  };

  // 出力ディレクトリが存在しない場合は作成
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, JSON.stringify(sdfJson));
  console.log("SDFデータを保存しました:", outputPath);
})();

// メッシュからSDFを生成する関数
async function createSDF(
  mesh: THREE.Mesh,
  size: number
): Promise<Float32Array> {
  // SDFの生成
  const sdfData = new Float32Array(size * size * size);

  // AABBを計算
  mesh.geometry.computeBoundingBox();
  const boundingBox = mesh.geometry.boundingBox!;
  const min = boundingBox.min.clone();
  const max = boundingBox.max.clone();

  const delta = new THREE.Vector3(
    (max.x - min.x) / size,
    (max.y - min.y) / size,
    (max.z - min.z) / size
  );

  // メッシュのBVHを構築
  const bvh = new MeshBVH(mesh.geometry);
  mesh.geometry.boundsTree = bvh; // boundsTree を設定

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
        const distance = getSignedDistance(point, mesh, bvh);
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
  mesh: THREE.Mesh,
  bvh: MeshBVH
): number {
  // メッシュの外側か内側かを判定
  const dir = new THREE.Vector3(1, 0, 0);
  const raycaster = new THREE.Raycaster(point, dir);
  const intersects = raycaster.intersectObject(mesh, true);
  const sign = intersects.length % 2 === 0 ? 1 : -1;

  // 点からメッシュまでの最近接距離を計算
  const hitResult: HitPointInfo = {
    point: new THREE.Vector3(),
    distance: Infinity,
    faceIndex: -1,
  };

  const distance = bvh.closestPointToPoint(point, hitResult)?.distance;

  if (!distance) {
    return 0;
  }

  return distance * sign;
}
