import "./app.css";

const app = document.getElementById("app");
if (app) {
  app.innerHTML = `
    <div class="hero min-h-screen">
      <div class="hero-content text-center">
        <div class="max-w-md">
          <h1 class="text-5xl font-bold">eJay Sound Browser</h1>
          <p class="py-6">Browse and play extracted audio samples from 14 eJay music software titles.</p>
        </div>
      </div>
    </div>
  `;
}
