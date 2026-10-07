/**
 * SnapCameraKitController
 * Official Snap Camera Kit Web SDK integration for loading Snapchat Lenses.
 */

class SnapCameraKitController {
  constructor() {
    this.cameraKit = null;
    this.session = null;
    this.activeLens = null;
    this.isConnected = false;
    this.apiToken = localStorage.getItem('snap_api_token') || '';
    this.lensGroupId = localStorage.getItem('snap_lens_group_id') || '';
    this.lenses = [];
    this.outputCanvas = null;
  }

  getSdk() {
    if (window.SnapCameraKit) return window.SnapCameraKit;
    if (window.SnapCameraKitModule) return window.SnapCameraKitModule;
    return null;
  }

  async connect(apiToken, lensGroupId) {
    if (!apiToken) {
      throw new Error('API Token de Snap Camera Kit requerido');
    }

    const sdk = this.getSdk();
    if (!sdk || !sdk.bootstrapCameraKit) {
      throw new Error('El SDK de Snap Camera Kit no está cargado en la aplicación.');
    }

    try {
      console.log('[SnapCameraKit] Bootstrapping Snap Camera Kit con SDK...');
      const { bootstrapCameraKit } = sdk;

      this.cameraKit = await bootstrapCameraKit({
        apiToken: apiToken
      });

      this.apiToken = apiToken;
      this.lensGroupId = lensGroupId;
      localStorage.setItem('snap_api_token', apiToken);
      if (lensGroupId) localStorage.setItem('snap_lens_group_id', lensGroupId);

      this.session = await this.cameraKit.createSession();
      this.outputCanvas = this.session.output.live;
      this.isConnected = true;

      console.log('[SnapCameraKit] Connected successfully!');

      if (lensGroupId) {
        await this.loadLensGroup(lensGroupId);
      }

      return {
        success: true,
        session: this.session,
        outputCanvas: this.outputCanvas,
        lenses: this.lenses
      };
    } catch (err) {
      console.error('[SnapCameraKit] Connection failed:', err);
      this.isConnected = false;
      throw err;
    }
  }

  async loadLensGroup(groupId) {
    if (!this.cameraKit || !groupId) return [];
    try {
      const lensRepository = this.cameraKit.lensRepository;
      const lensGroup = await lensRepository.loadLensGroup(groupId);
      this.lenses = lensGroup.lenses || [];
      console.log(`[SnapCameraKit] Loaded ${this.lenses.length} lenses for group ${groupId}`);
      return this.lenses;
    } catch (err) {
      console.warn('[SnapCameraKit] Error loading lens group:', err);
      return [];
    }
  }

  async applyLens(lensId) {
    if (!this.session) return false;
    try {
      const lens = this.lenses.find(l => l.id === lensId) || await this.cameraKit.lensRepository.loadLens(lensId, this.lensGroupId);
      if (lens) {
        await this.session.applyLens(lens);
        this.activeLens = lens;
        console.log('[SnapCameraKit] Applied lens:', lens.name);
        return true;
      }
    } catch (err) {
      console.error('[SnapCameraKit] Failed to apply lens:', err);
    }
    return false;
  }

  async clearLens() {
    if (this.session) {
      await this.session.clearLens();
      this.activeLens = null;
    }
  }

  async setSourceStream(mediaStream) {
    if (!this.session || !mediaStream) return;
    const sdk = this.getSdk();
    if (!sdk || !sdk.createMediaStreamSource) return;

    try {
      const source = sdk.createMediaStreamSource(mediaStream, {
        cameraType: 'front'
      });
      await this.session.setSource(source);
      await this.session.play();
      console.log('[SnapCameraKit] Source stream set successfully');
    } catch (err) {
      console.error('[SnapCameraKit] Failed to set media source:', err);
    }
  }
}

window.SnapCameraKitController = SnapCameraKitController;
