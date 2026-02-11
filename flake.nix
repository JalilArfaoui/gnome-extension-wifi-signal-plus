{
  description = "WiFi Signal Plus - GNOME Shell Extension";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # Node.js
            nodejs_22
            nodePackages.npm

            # Pour l'extension GNOME
            glib
            gobject-introspection
            gnome-shell

            # Outils WiFi
            iw
            wirelesstools

            # Outils de développement
            gnome-extensions-cli
          ];

          shellHook = ''
            echo "🛜 WiFi Signal Plus - Dev Environment"
            echo ""
            echo "Commands:"
            echo "  npm install          - Install dependencies"
            echo "  npm run build        - Build extension"
            echo "  npm run install-extension - Install to GNOME"
            echo "  npm run lint         - Run ESLint"
            echo "  npm run test         - Run tests"
            echo ""
          '';
        };
      }
    );
}
