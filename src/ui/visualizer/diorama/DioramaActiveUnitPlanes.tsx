import React from 'react';
import * as THREE from 'three';
import { UNSUNG_UNIT_OPACITY } from './dioramaSceneConstants';
import { type PlacedUnitRaster } from './dioramaSceneTypes';
import { type DioramaUnitPlanes } from './dioramaSceneFrame';

// src/ui/visualizer/diorama/DioramaActiveUnitPlanes.tsx
// 当前行逐单元的三层平面：普通辉光（叠加的心象辉光栅格）、灵魂出窍（叠加的清晰副本）、字身。
// 只负责挂载与登记材质 / 网格引用，每帧的颜色、透明度与位移由 dioramaSceneFrame 写入。

interface DioramaActiveUnitPlanesProps {
    units: readonly PlacedUnitRaster[];
    /** Filled by the ref callbacks; read by updateDioramaActiveUnits every frame. */
    planes: DioramaUnitPlanes;
    primaryColor: string;
    accentColor: string;
}

export const DioramaActiveUnitPlanes: React.FC<DioramaActiveUnitPlanesProps> = ({ units, planes, primaryColor, accentColor }) => (
    <>
        {units.map((placed, unitIndex) => (
            <React.Fragment key={unitIndex}>
                <mesh
                    ref={el => { planes.glowMeshes[unitIndex] = el; }}
                    visible={false}
                    position={[placed.centerX, 0, -0.01]}
                    renderOrder={17}
                >
                    <planeGeometry args={[placed.width, placed.height]} />
                    <meshBasicMaterial
                        ref={el => { planes.glowMats[unitIndex] = el; }}
                        map={placed.raster.glowTexture}
                        transparent
                        opacity={0}
                        depthTest={false}
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                        color={accentColor}
                    />
                </mesh>
                {/* 灵魂出窍 ghost: the CRISP base raster (not the blurred glow) drawn
                    additively; useFrame lifts/swells/fades it as its envelope releases. */}
                <mesh
                    ref={el => { planes.soulMeshes[unitIndex] = el; }}
                    visible={false}
                    position={[placed.centerX, 0, -0.005]}
                    renderOrder={18}
                >
                    <planeGeometry args={[placed.width, placed.height]} />
                    <meshBasicMaterial
                        ref={el => { planes.soulMats[unitIndex] = el; }}
                        map={placed.raster.baseTexture}
                        transparent
                        opacity={0}
                        depthTest={false}
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                        color={accentColor}
                    />
                </mesh>
                <mesh position={[placed.centerX, 0, 0]} renderOrder={19}>
                    <planeGeometry args={[placed.width, placed.height]} />
                    <meshBasicMaterial
                        ref={el => { planes.baseMats[unitIndex] = el; }}
                        map={placed.raster.baseTexture}
                        transparent
                        opacity={UNSUNG_UNIT_OPACITY}
                        depthTest={false}
                        depthWrite={false}
                        color={primaryColor}
                    />
                </mesh>
            </React.Fragment>
        ))}
    </>
);
