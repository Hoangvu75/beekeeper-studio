<template>
  <div class="global-status-bar">
    <div
      v-if="!embeddedMode"
      class="connection-button-wrapper"
      :style="{
        ['--connection-button-icon-width']: connectionButtonIconWidth + 'px',
        width: connectionButtonWidth + 'px',
      }"
    >
      <connection-button />
    </div>
    <portal-target name="global-status-bar"></portal-target>
  </div>
</template>

<script>
import { PortalTarget } from "portal-vue";
import ConnectionButton from "./sidebar/core/ConnectionButton.vue";

const detectEmbeddedMode = () => {
  try {
    const params = new URLSearchParams(window.location.search || "");
    if (params.has("marixEmbed") || params.has("openUrl") || params.has("url")) {
      window.sessionStorage.setItem("marixEmbed", "1");
      return true;
    }
    return window.sessionStorage.getItem("marixEmbed") === "1";
  } catch (_err) {
    return false;
  }
};

export default {
  components: { PortalTarget, ConnectionButton },
  props: {
    connectionButtonWidth: Number,
    connectionButtonIconWidth: Number,
  },
  data() {
    return {
      embeddedMode: detectEmbeddedMode(),
    };
  },
};
</script>
