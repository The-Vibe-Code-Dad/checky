!macro customInstall
  CreateShortCut "$DESKTOP\\${PRODUCT_NAME}.lnk" "$INSTDIR\\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\\resources\\icon.ico"
!macroend
