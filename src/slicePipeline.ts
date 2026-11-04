/**
 * Shared vtk.js pipeline: the 3D label volume → a 2D slice on any plane.
 *
 * vtkImageReslice samples the volume on the (possibly tilted) plane, using
 * nearest-neighbour lookup so labels are never blended. Both the main 2D view
 * and the 3D preview draw this one resliced image.
 */

import vtkImageData from "@kitware/vtk.js/Common/DataModel/ImageData";
import vtkDataArray from "@kitware/vtk.js/Common/Core/DataArray";
import vtkImageReslice from "@kitware/vtk.js/Imaging/Core/ImageReslice";
import vtkColorTransferFunction from "@kitware/vtk.js/Rendering/Core/ColorTransferFunction";
import vtkPiecewiseFunction from "@kitware/vtk.js/Common/DataModel/PiecewiseFunction";
import { InterpolationMode } from "@kitware/vtk.js/Imaging/Core/AbstractImageInterpolator/Constants";

import type { Atlas } from "./atlas";
import { displayColor } from "./colors";
import { type SlicePlane, planeToAtlasMatrix } from "./slicePlane";

export type SlicePipeline = ReturnType<typeof createSlicePipeline>;

export function createSlicePipeline(atlas: Atlas) {
  // --- The label volume ---
  const volume = vtkImageData.newInstance({ spacing: atlas.spacing });
  volume.setDimensions(atlas.dims);
  volume.getPointData().setScalars(vtkDataArray.newInstance({ values: atlas.data, numberOfComponents: 1 }));

  // --- Reslicer: samples the volume on the plane ---
  const reslice = vtkImageReslice.newInstance();
  reslice.setInputData(volume);
  reslice.setOutputDimensionality(2);
  reslice.setInterpolationMode(InterpolationMode.NEAREST);
  reslice.setBackgroundColor([0, 0, 0, 0]); // outside the volume = background label 0

  // --- One colour per label ---
  const colors = vtkColorTransferFunction.newInstance();
  for (let label = 0; label < atlas.ids.length; label++) {
    const [r, g, b] = displayColor(label);
    colors.addRGBPoint(label, r, g, b);
  }

  // --- Opacity: background (label 0) see-through, every region opaque ---
  const opacity = vtkPiecewiseFunction.newInstance();
  opacity.addPoint(0, 0);
  opacity.addPoint(0.5, 0);
  opacity.addPoint(0.51, 1);
  opacity.addPoint(atlas.ids.length, 1);

  let currentPlane: SlicePlane | null = null;

  /** Point the reslicer at a new plane (output pixels = atlas voxel size). */
  function setPlane(plane: SlicePlane) {
    const pixelSize = atlas.spacing[0];
    const width = Math.floor((plane.rightMax - plane.rightMin) / pixelSize) + 1;
    const height = Math.floor((plane.upMax - plane.upMin) / pixelSize) + 1;

    reslice.setResliceAxes(planeToAtlasMatrix(plane));
    reslice.setOutputOrigin([plane.rightMin, plane.upMin, 0]);
    reslice.setOutputSpacing([pixelSize, pixelSize, pixelSize]);
    reslice.setOutputExtent([0, width - 1, 0, height - 1, 0, 0]);
    currentPlane = plane;
  }

  /** The ontology ID at a point given in plane coordinates (µm), or null for background. */
  function ontologyIdAt(planeX: number, planeY: number): number | null {
    const slice = reslice.getOutputData();
    const [originX, originY] = slice.getOrigin();
    const [pixelSize] = slice.getSpacing();
    const [width, height] = slice.getDimensions();

    const col = Math.round((planeX - originX) / pixelSize);
    const row = Math.round((planeY - originY) / pixelSize);
    if (col < 0 || row < 0 || col >= width || row >= height) return null;

    const label = slice.getPointData().getScalars().getData()[row * width + col];
    return label ? atlas.ids[label] : null;
  }

  /** The current slice's labels, with row 0 at the TOP of the screen (vtk stores bottom row first). */
  function currentSliceLabels(): SliceLabels {
    const slice = reslice.getOutputData();
    const [width, height] = slice.getDimensions();
    const bottomUp = slice.getPointData().getScalars().getData();

    const labels = new Uint16Array(width * height);
    for (let row = 0; row < height; row++) {
      const sourceRow = height - 1 - row;
      labels.set(bottomUp.subarray(sourceRow * width, (sourceRow + 1) * width), row * width);
    }
    const [originRight, originUp] = slice.getOrigin(); // centre of vtk's bottom-left pixel, in plane µm
    const umPerPx = slice.getSpacing()[0];
    return {
      labels,
      width,
      height,
      umPerPx,
      firstColumnRightUm: originRight,
      firstRowUpUm: originUp + (height - 1) * umPerPx, // our row 0 is vtk's top row
    };
  }

  return {
    reslice,
    colors,
    opacity,
    setPlane,
    ontologyIdAt,
    currentSliceLabels,
    getPlane: () => currentPlane,
  };
}

export interface SliceLabels {
  labels: Uint16Array; // compact label per pixel, row 0 = top; 0 = background
  width: number;
  height: number;
  umPerPx: number;
  // Where pixel centres sit on the plane (µm from the plane's centre along right / up):
  firstColumnRightUm: number; // column 0
  firstRowUpUm: number; // row 0 (the top row)
}
