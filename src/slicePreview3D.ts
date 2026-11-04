/**
 * Small rotatable 3D preview: a see-through brain with the current slice
 * placed inside it, so you can see where the (tilted) plane cuts.
 *
 * Mouse: left-drag rotates, scroll zooms.
 */

import "@kitware/vtk.js/Rendering/Profiles/Volume"; // image slices
import "@kitware/vtk.js/Rendering/Profiles/Geometry"; // surface meshes
import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";
import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkImageMarchingCubes from "@kitware/vtk.js/Filters/General/ImageMarchingCubes";
import vtkMapper from "@kitware/vtk.js/Rendering/Core/Mapper";
import vtkActor from "@kitware/vtk.js/Rendering/Core/Actor";
import vtkImageMapper from "@kitware/vtk.js/Rendering/Core/ImageMapper";
import vtkImageSlice from "@kitware/vtk.js/Rendering/Core/ImageSlice";

import type { Atlas, Vec3 } from "./atlas";
import type { SlicePipeline } from "./slicePipeline";
import { planeToAtlasMatrix } from "./slicePlane";

export interface SlicePreview3D {
  /** Move the slice to the pipeline's current plane and redraw. */
  update(): void;
  resize(): void;
  destroy(): void;
}

const BACKGROUND: Vec3 = [0.1, 0.11, 0.13];

// The brain surface is built from a coarser copy of the atlas (every Nth voxel) to keep it fast.
const SURFACE_DOWNSAMPLE = 4;

export function createSlicePreview3D(container: HTMLElement, atlas: Atlas, pipeline: SlicePipeline): SlicePreview3D {
  const renderWindow = vtkGenericRenderWindow.newInstance({ background: BACKGROUND });
  renderWindow.setContainer(container);
  renderWindow.resize();
  const renderer = renderWindow.getRenderer();

  // --- Translucent brain surface ---
  const surface = vtkActor.newInstance();
  const surfaceMapper = vtkMapper.newInstance();
  surfaceMapper.setInputData(buildBrainSurface(atlas));
  surface.setMapper(surfaceMapper);
  surface.getProperty().setColor(0.8, 0.8, 0.85);
  surface.getProperty().setOpacity(0.3);
  renderer.addActor(surface);

  // --- The current slice, placed in 3D by the plane's matrix ---
  const sliceMapper = vtkImageMapper.newInstance();
  sliceMapper.setInputConnection(pipeline.reslice.getOutputPort());

  const slice = vtkImageSlice.newInstance({ mapper: sliceMapper });
  const property = slice.getProperty();
  property.setRGBTransferFunction(0, pipeline.colors);
  property.setPiecewiseFunction(0, pipeline.opacity); // background is see-through
  property.setUseLookupTableScalarRange(true);
  property.setInterpolationTypeToNearest();
  renderer.addActor(slice);

  setStartingCamera();

  /** Look at the brain from the front-left and slightly above, dorsal side up. */
  function setStartingCamera() {
    const camera = renderer.getActiveCamera();
    // Atlas axes: x = left→right, y = dorsal→ventral, z = anterior→posterior.
    camera.setPosition(-1, -0.7, -1.2); // left, dorsal, anterior of the focal point
    camera.setFocalPoint(0, 0, 0);
    camera.setViewUp(0, -1, 0); // dorsal is up
    renderer.resetCamera();
    camera.zoom(1.6); // resetCamera leaves a wide margin; fill the small window
  }

  return {
    update() {
      const plane = pipeline.getPlane();
      if (plane) slice.setUserMatrix(planeToAtlasMatrix(plane));
      renderWindow.getRenderWindow().render();
    },
    resize: () => renderWindow.resize(),
    destroy: () => renderWindow.delete(),
  };
}

/** Outer brain surface: every labelled voxel is "inside", traced with marching cubes. */
function buildBrainSurface({ dims, spacing, data }: Atlas) {
  const step = SURFACE_DOWNSAMPLE;
  const smallDims = dims.map((n) => Math.ceil(n / step)) as Vec3;
  const mask = new Uint8Array(smallDims[0] * smallDims[1] * smallDims[2]);

  for (let z = 0; z < smallDims[2]; z++) {
    for (let y = 0; y < smallDims[1]; y++) {
      for (let x = 0; x < smallDims[0]; x++) {
        const voxel = x * step + y * step * dims[0] + z * step * dims[0] * dims[1];
        mask[x + y * smallDims[0] + z * smallDims[0] * smallDims[1]] = data[voxel] ? 1 : 0;
      }
    }
  }

  const image = vtkImageData.newInstance({ spacing: spacing.map((s) => s * step) as Vec3 });
  image.setDimensions(smallDims);
  image.getPointData().setScalars(vtkDataArray.newInstance({ values: mask, numberOfComponents: 1 }));

  const marchingCubes = vtkImageMarchingCubes.newInstance({ contourValue: 0.5, computeNormals: true, mergePoints: true });
  marchingCubes.setInputData(image);
  return marchingCubes.getOutputData();
}