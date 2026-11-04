/**
 * Main 2D view: shows the current (possibly tilted) slice face-on.
 *
 * The resliced image lives in plane coordinates (x = right, y = up), so the
 * camera simply looks straight down at it. Mouse: left-drag pans, right-drag
 * or scroll zooms.
 */

import "@kitware/vtk.js/Rendering/Profiles/Volume";
import vtkGenericRenderWindow from "@kitware/vtk.js/Rendering/Misc/GenericRenderWindow";
import vtkImageMapper from "@kitware/vtk.js/Rendering/Core/ImageMapper";
import vtkImageSlice from "@kitware/vtk.js/Rendering/Core/ImageSlice";
import vtkInteractorStyleManipulator from "@kitware/vtk.js/Interaction/Style/InteractorStyleManipulator";
import vtkPanManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballPanManipulator";
import vtkZoomManipulator from "@kitware/vtk.js/Interaction/Manipulators/MouseCameraTrackballZoomManipulator";

import type { Vec3 } from "./atlas";
import type { SlicePipeline } from "./slicePipeline";

export interface SliceViewer {
  /** Redraw after the pipeline's plane changed. */
  render(): void;
  /** Centre the slice and zoom so all of it fits. */
  fitToView(): void;
  resize(): void;
  destroy(): void;
}

const BACKGROUND: Vec3 = [0.07, 0.08, 0.09];

/**
 * @param onHover called with the ontology ID under the mouse (or null outside the brain)
 */
export function createSliceViewer(
  container: HTMLElement,
  pipeline: SlicePipeline,
  onHover: (ontologyId: number | null) => void,
): SliceViewer {
  const renderWindow = vtkGenericRenderWindow.newInstance({ background: BACKGROUND });
  renderWindow.setContainer(container);
  renderWindow.resize();

  const renderer = renderWindow.getRenderer();

  // --- Draw the resliced image ---
  const mapper = vtkImageMapper.newInstance();
  mapper.setInputConnection(pipeline.reslice.getOutputPort());

  const actor = vtkImageSlice.newInstance({ mapper });
  const property = actor.getProperty();
  property.setRGBTransferFunction(0, pipeline.colors);
  property.setUseLookupTableScalarRange(true);
  property.setInterpolationTypeToNearest(); // labels must never be blended
  renderer.addActor(actor);

  // --- Mouse controls: pan and zoom only (no rotation) ---
  const style = vtkInteractorStyleManipulator.newInstance();
  style.addMouseManipulator(vtkPanManipulator.newInstance({ button: 1 }));
  style.addMouseManipulator(vtkZoomManipulator.newInstance({ button: 3 }));
  style.addMouseManipulator(vtkZoomManipulator.newInstance({ scrollEnabled: true, dragEnabled: false }));
  renderWindow.getInteractor().setInteractorStyle(style);

  // --- Hover: look up the region under the mouse ---
  renderWindow.getInteractor().onMouseMove(({ position }) => {
    const [planeX, planeY] = renderWindow
      .getApiSpecificRenderWindow()
      .displayToWorld(position.x, position.y, 0, renderer);
    onHover(pipeline.ontologyIdAt(planeX, planeY));
  });

  function fitToView() {
    const plane = pipeline.getPlane();
    if (!plane) return;

    const camera = renderer.getActiveCamera();
    camera.setParallelProjection(true);
    renderer.resetCamera(); // looks down at the image, centred

    // Parallel scale = half the visible height (in µm). Fit whichever of width/height is tighter.
    const sliceWidth = plane.rightMax - plane.rightMin;
    const sliceHeight = plane.upMax - plane.upMin;
    const { width, height } = container.getBoundingClientRect();
    const heightNeeded = Math.max(sliceHeight, (sliceWidth * height) / width);
    const margin = 1.04;
    camera.setParallelScale((heightNeeded / 2) * margin);
  }

  return {
    render: () => renderWindow.getRenderWindow().render(),
    fitToView,
    resize: () => renderWindow.resize(),
    destroy: () => renderWindow.delete(),
  };
}
