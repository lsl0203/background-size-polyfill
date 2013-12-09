var o; // and so it is

(function( element, window ) {

var rsrc = /url\(["']?(.*?)["']?\)/,
	rprespace = /^\s\s*/,
	rpostspace = /\s\s*$/,
	rmidspace = /\s\s*/g,
	rpercent = /%$/,
	rruntimestyles = /(^|;)\s*(background-image|position|z-index):[^;]*/gi, // this could be better
	positions = {
		top: 0,
		left: 0,
		bottom: 1,
		right: 1,
		center: 0.5
	},
	doc = element.document,
	wrapperClass = "background-size-polyfill",
	noop = function() {},
	resizeInterval = 100,
	resizeId,
	processSnapshotId,
	updateEventId,
	updateBackgroundCallbackId;

// remove the background-image and emulate it with a wrapped <img/>
function init() {
	var wrapper = doc.createElement( "div" ),
		img = doc.createElement( "img" ),
		wrapperStyle = wrapper.style,
		expando = element.bgsExpando,
		cloneWrapper = element.firstChild;

	if ( expando && cloneWrapper &&
			( cloneWrapper.nodeName || "" ).toUpperCase() === "DIV" &&
			cloneWrapper.className === wrapperClass) {
		element.removeChild( cloneWrapper );
	}

	setStyles( wrapper );
	wrapper.className = wrapperClass;
	wrapperStyle.top =
		wrapperStyle.right =
		wrapperStyle.bottom =
		wrapperStyle.left = 0;
	wrapperStyle.position = "fixed"; // test value

	setStyles( img );
	img.alt = "";

	wrapper.appendChild( img );

	element.insertBefore( wrapper, element.firstChild );

	// save useful data for quick access
	element.bgsExpando = expando = {
		wrapper: wrapper,
		img: img,
		current: {},       // current snapshot
		next: null,        // next snapshot to process
		processing: false, // whether we are in the middle of processing the next snapshot
		loadImg: null,     // temp img element/object from getImageDimensions
		display: false,    // element's display property
		changed: false,    // whether element's display property has changed
		ignore: false,     // whether to ignore the next property change event
		// whether we can support background-attachment: fixed for this element/browser
		canFixed: element.nodeName.toUpperCase() === "BODY" && wrapper.offsetHeight > 0
	};

	wrapperStyle.position = "absolute";

	o = {
		init: noop, // allow init() to be called only once
		handlePropertychange: handlePropertychange,
		restore: restore,
		handleResize: handleResize
	};

	handlePropertychange();
}

function setStyles( el ) {
	var style = el.style;

	style.position = "absolute";
	style.display = "block";
	style.zIndex = -1;
	style.overflow = "hidden";
	style.visibility = "inherit";
	style.width =
		style.height =
		style.top =
		style.right =
		style.bottom =
		style.left =
		style.cursor = "auto";
	style.margin =
		style.padding =
		style.border =
		style.outline =
		style.minWidth =
		style.minHeight = 0;
	style.background =
		style.maxWidth =
		style.maxHeight = "none";
	style.fontSize =
		style.lineHeight = "1em";
}

function getImageDimensions( expando, src, callback ) {
	var img;

	if ( src ) {
		img = doc.createElement( "img" );
		img.onload = img.onerror = function() {
			var width = this.width,
				height = this.height;
			if ( window.event.type === "error" ) {
				width = height = 0;
			}
			expando.loadImg = this.onload = this.onerror = null;
			callback( width, height );
		};
		img.src = src;

	} else {
		img = {
			callbackId: window.setTimeout( function() {
				expando.loadImg = null;
				callback( 0, 0 );
			}, 0 )
		};
	}

	expando.loadImg = img;
	img = null;
}

// this prevents handling propertychange events caused by this script
function suspendPropertychange( callback ) {
	var fn = o.handlePropertychange;
	o.handlePropertychange = noop;
	callback();
	o.handlePropertychange = fn;
}

function refreshDisplay( element, expando ) {
	var display = element.currentStyle.display;

	if ( display !== expando.display ) {
		expando.display = display;
		expando.changed = true;
	}

	return display !== "none";
}

function takeSnapshot( element ) {
	var elementCurrentStyle = element.currentStyle,
		elementRuntimeStyle = element.runtimeStyle,
		size = normalizeCSSValue( elementCurrentStyle["background-size"] ),
		sizeList = size.split( " " ),
		snapshot = {
			innerWidth: element.offsetWidth -
				( parseFloat( elementCurrentStyle.borderLeftWidth ) || 0 ) -
				( parseFloat( elementCurrentStyle.borderRightWidth ) || 0 ),
			innerHeight: element.offsetHeight -
				( parseFloat( elementCurrentStyle.borderTopWidth ) || 0 ) -
				( parseFloat( elementCurrentStyle.borderBottomWidth ) || 0 ),
			size: size,
			sizeIsKeyword: size === "contain" || size === "cover",
			sizeX: sizeList[0],
			sizeY: sizeList.length > 1 ? sizeList[1] : "auto",
			posX: elementCurrentStyle.backgroundPositionX,
			posY: elementCurrentStyle.backgroundPositionY,
			attachment: elementCurrentStyle.backgroundAttachment,
			src: "",
			imgWidth: 0,
			imgHeight: 0
		},
		important = " !important",
		runtimeCSSText;

	// length / percentage size
	if ( !snapshot.sizeIsKeyword ) {
		// negative lengths or percentages are not allowed
		if ( !( ( parseFloat( snapshot.sizeX ) >= 0 || snapshot.sizeX === "auto" ) &&
				( parseFloat( snapshot.sizeY ) >= 0 || snapshot.sizeY === "auto" ) ) ) {
			snapshot.sizeX = snapshot.sizeY = "auto";
		}

		// percentages are relative to the element, not image, width/height
		if ( rpercent.test( snapshot.sizeX ) ) {
			snapshot.sizeX = ( snapshot.innerWidth * parseFloat( snapshot.sizeX ) / 100 || 0 ) + "px";
		}
		if ( rpercent.test( snapshot.sizeY ) ) {
			snapshot.sizeY = ( snapshot.innerHeight * parseFloat( snapshot.sizeY ) / 100 || 0 ) + "px";
		}
	}

	// keyword / percentage positions
	if ( snapshot.posX in positions || rpercent.test( snapshot.posX ) ) {
		snapshot.posX = positions[ snapshot.posX ] || parseFloat( snapshot.posX ) / 100 || 0;
	}
	if ( snapshot.posY in positions || rpercent.test( snapshot.posY ) ) {
		snapshot.posY = positions[ snapshot.posY ] || parseFloat( snapshot.posY ) / 100 || 0;
	}

	// image (and position / z-index)
	// undo our changes before measuring
	suspendPropertychange( function() {
		elementRuntimeStyle.cssText = elementRuntimeStyle.cssText.replace( rruntimestyles, "" );
	} );
	snapshot.src = ( rsrc.exec( elementCurrentStyle.backgroundImage ) || [] )[1];

	runtimeCSSText = [ elementRuntimeStyle.cssText, "background-image: none" + important ];
	// This is the part where we mess with the existing DOM
	// to make sure that the background image is correctly zIndexed
	if ( elementCurrentStyle.zIndex === "auto" ) {
		runtimeCSSText.push( "z-index: 0" + important );
	}
	if ( elementCurrentStyle.position === "static" ) {
		runtimeCSSText.push( "position: relative" + important );
	}
	suspendPropertychange( function() {
		// setting cssText allows us to set styles with "!important"
		elementRuntimeStyle.cssText = runtimeCSSText.join( ";" );
	} );

	return snapshot;
}

function normalizeCSSValue( value ) {
	return String( value ).replace( rprespace, "" ).replace( rpostspace, "" ).replace( rmidspace, " " );
}

function processSnapshot( element, expando ) {
	var snapshot = expando.next;

	function loop() {
		processSnapshotId = window.setTimeout( function() {
			expando.processing = false;
			processSnapshot( element, expando );
		}, 0 );
	}

	if ( !expando.processing && snapshot ) {
		expando.next = null;
		expando.processing = true;

		getImageDimensions( expando, snapshot.src, function( width, height ) {
			snapshot.imgWidth = width;
			snapshot.imgHeight = height;

			if ( isChanged( expando, snapshot ) ) {
				updateBackground( element, expando, snapshot, loop );
			} else {
				loop();
			}
		} );
	}
}

function isChanged( expando, snapshot ) {
	var expandoCurrent = expando.current,
		changed = false,
		prop;

	if ( expando.changed ) {
		// display changed
		expando.changed = false;
		changed = true;

	} else {
		for ( prop in snapshot ) {
			if ( snapshot[prop] !== expandoCurrent[prop] ) {
				changed = true;
				break;
			}
		}
	}

	return changed;
}

function updateBackground( element, expando, snapshot, callback ) {
	var img = expando.img,
		imgStyle = img.style,
		size = snapshot.size,
		innerWidth = snapshot.innerWidth,
		innerHeight = snapshot.innerHeight,
		imgWidth = snapshot.imgWidth,
		imgHeight = snapshot.imgHeight,
		posX = snapshot.posX,
		posY = snapshot.posY,
		posXIsPercent = typeof posX === "number",
		posYIsPercent = typeof posY === "number",
		display = "none",
		left = 0,
		top = 0,
		width = "auto",
		height = "auto",
		px = "px",
		oneHundredPercent = "100%",
		elemRatio,
		imgRatio;

	if ( innerWidth && innerHeight && imgWidth && imgHeight ) {
		expando.wrapper.style.position =
			snapshot.attachment === "fixed" && expando.canFixed ?
			"fixed" : "absolute";

		img.src = snapshot.src;

		// can we do Math.round() instead of flooring towards zero?

		if ( snapshot.sizeIsKeyword ) {
			elemRatio = innerWidth / innerHeight;
			imgRatio = imgWidth / imgHeight;

			if ( ( size === "contain" && imgRatio > elemRatio ) ||
					( size === "cover" && elemRatio > imgRatio ) ) {
				top = floorTowardsZero( ( innerHeight - innerWidth / imgRatio ) * posY ) + px;
				width = oneHundredPercent;

			// size === "contain" && elemRatio > imgRatio ||
			// size === "cover" && imgRatio > elemRatio
			} else {
				left = floorTowardsZero( ( innerWidth - innerHeight * imgRatio ) * posX ) + px;
				height = oneHundredPercent;
			}

			imgStyle.left = posXIsPercent ? left : posX;
			imgStyle.top = posYIsPercent ? top : posY;
			imgStyle.width = width;
			imgStyle.height = height;

			display = "block";

		} else {
			// need to set width/height then calculate left/top from the actual width/height
			imgStyle.display = "block";
			imgStyle.width = snapshot.sizeX;
			imgStyle.height = snapshot.sizeY;

			imgWidth = img.width;
			imgHeight = img.height;

			if ( imgWidth && imgHeight ) {
				imgStyle.left = posXIsPercent ? floorTowardsZero( ( innerWidth - imgWidth ) * posX ) + px : posX;
				imgStyle.top = posYIsPercent ? floorTowardsZero( ( innerHeight - imgHeight ) * posY ) + px : posY;

				display = "block";
			}
		}
	}

	imgStyle.display = display;

	expando.current = snapshot;

	// img onload may be called synchronously, leading to us trying to
	// fire onbackgroundupdate within init(), causing an error
	// so wrap it with setTimeout()
	updateEventId = window.setTimeout( function() {
		updateBackgroundCallbackId = window.setTimeout( callback, 0 );

		// if any properties are changed here, processSnapshot() will process them later
		// if ondetach is triggered, updateBackgroundCallbackId will be cleared
		updateEvent.fire();
	}, 0 );
}

function floorTowardsZero( value ) {
	var isNegative = value < 0;
	value = Math.floor( Math.abs( value ) );
	return isNegative ? -value : value;
}

// handle different style changes
function handlePropertychange() {
	var expando = element.bgsExpando,
		propertyName = ( window.event || {} ).propertyName,
		backgroundImageProperty = "style.backgroundImage";

	if ( expando.ignore ) {
		expando.ignore = false;
		if ( propertyName === backgroundImageProperty ) {
			return;
		}
	}

	// if the changed property is style.backgroundImage
	// and its value is set to a non-empty string,
	// then the propertychange event will be fired twice
	// http://blog.csdn.net/hax/article/details/1346542
	if ( propertyName === backgroundImageProperty && element.style.backgroundImage ) {
		expando.ignore = true;
	}

	if ( refreshDisplay( element, expando ) ) {
		// since each snapshot includes changes all previous snapshots,
		// we can replace the old next snapshot with a new one
		expando.next = takeSnapshot( element );
		processSnapshot( element, expando );
	}
}

function handleResize() {
	window.clearTimeout( resizeId );
	resizeId = window.setTimeout( handlePropertychange, resizeInterval );
}

function restore() {
	var elementRuntimeStyle = element.runtimeStyle,
		expando = element.bgsExpando,
		loadImg;

	o = {
		init: noop,
		handlePropertychange: noop,
		restore: noop,
		handleResize: noop
	};

	window.clearTimeout( resizeId );
	window.clearTimeout( processSnapshotId );
	window.clearTimeout( updateEventId );
	window.clearTimeout( updateBackgroundCallbackId );

	try {
		if ( elementRuntimeStyle ) {
			// should we save and restore runtime styles here?
			elementRuntimeStyle.cssText = elementRuntimeStyle.cssText.replace( rruntimestyles, "" );
		}

		if ( expando ) {
			loadImg = expando.loadImg;
			if ( loadImg ) {
				loadImg.onload = loadImg.onerror = null;
				window.clearTimeout( loadImg.callbackId );
			}

			element.removeChild( expando.wrapper );
		}

		element.bgsExpando = null;

	} catch ( e ) {}

	element = window = doc = noop = null;
}

// don't allow anything until init() is called
// IE seems to think it needs to attach the behavior a second time for printing
o = {
	init: doc.media !== "print" ? init : noop,
	handlePropertychange: noop,
	restore: noop,
	handleResize: noop
};

if ( element.readyState === "complete" ) {
	o.init();
}

})( element, window );
