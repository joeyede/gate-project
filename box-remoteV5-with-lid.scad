// Parametric 3D-printable enclosure with removable lid and screw-mount points
// Based on box-remoteV1.scad

// === User-adjustable parameters ===
wall_thickness   = 2;     // side wall thickness
floor_thickness  = 2;     // bottom plate thickness (and lid thickness)
base_clearance   = 1.5;   // clearance under boards
board_spacer     = 5;     // gap between boards
case_height      = 40;    // internal height for components
vent_slot_w      = 2;
vent_slot_h      = 1;
vent_gap         = 1;

// Screw-mount parameters for removable lid
screw_mount_d        = 6;   // outer diameter of boss
screw_hole_d         = 3;   // inner hole diameter for M3 screw
screw_mount_h        = 5;   // height of boss (now inset to clear the lid lip)
screw_hole_clearance = 0.2; // extra clearance on hole

//--- Board dimensions ---
// Board 3 (leftmost)
b3_l = 30; b3_w = 55; b3_h = 5;
b3_pin_d = 3; b3_pin_h = b3_h + base_clearance;
// Board 2 (middle)
b2_l = 27; b2_w = 50; b2_h = 5;
b2_pin_d = 3; b2_pin_h = b2_h + base_clearance;
// Pi Zero (rightmost)
pi_w = 30; pi_l = 65; pi_h = 5;
pi_mounts = [ [4, 4], [pi_w - 6, 4], [4, pi_l - 4], [pi_w - 4, pi_l - 4] ];
pi_standoff_outer_d = 6; pi_hole_d = 2.2; standoff_h = pi_h + base_clearance;
// Extra female standoff on Board 3
extra_d      = 5; extra_hole_d = 2.2;
// === Pi Zero port cutout parameters ===
usb_port_w = 24; usb_port_h = 5; usb_port_offset = 43; // adjust Y-offset to align micro-USB ports
hdmi_port_w = 16; hdmi_port_h = 5; hdmi_port_offset = 11.5; // adjust Y-offset to align HDMI port
port_cut_depth = wall_thickness + 0.1; // cut through-wall depth

// Derived dimensions
total_inner_x = b3_l + b2_l + pi_w + 2*board_spacer + 3;
total_inner_y = max(b3_w, b2_w, pi_l) + 2*board_spacer;
box_x = total_inner_x + 2*wall_thickness;
box_y = total_inner_y + 2*wall_thickness;
box_z = case_height;
vent_height = case_height * 2/3;
vent_rows = floor(((box_y - 2*wall_thickness) - vent_gap) / (vent_slot_h + vent_gap));

b3_x = wall_thickness + 3;
b2_x = b3_x + b3_l + board_spacer;
pi_x = b2_x + b2_l + board_spacer;
y_origin = wall_thickness + board_spacer;

module base() {
    difference() {
        cube([box_x, box_y, box_z], center=false);
        translate([wall_thickness, wall_thickness, floor_thickness])
            cube([total_inner_x, total_inner_y, box_z], center=false);
        for (sign = [-1, 1]) {
            side_x = (sign > 0) ? box_x : 0;
            translate([ side_x - (sign > 0 ? wall_thickness : 0), wall_thickness + vent_gap, vent_height ]) {
                for (i = [0 : vent_rows - 1]) {
                    translate([0, i*(vent_slot_h + vent_gap), 0])
                        cube([wall_thickness, vent_slot_h, vent_slot_w], center=false);
                }
            }
        }
        // Pi Zero port cutouts on right-hand wall
        // — Micro-USB ports
        translate(
          [ box_x - port_cut_depth, 
            wall_thickness + usb_port_offset, 
            floor_thickness + base_clearance + standoff_h/2]
        )
          cube(
            [ port_cut_depth,
              usb_port_w,
              usb_port_h ],
            center = false
          );
        // — HDMI port
        translate(
          [ box_x - port_cut_depth,
            wall_thickness + hdmi_port_offset,
            floor_thickness + base_clearance + standoff_h/2 ]
        )
          cube(
            [ port_cut_depth,
              hdmi_port_w,
              hdmi_port_h ],
            center = false
          );
    }
}

module mounts_and_pins() {
    // Board 3 corner support pins, bottom two pins moved +2mm in Y when dy==0
    for (dx = [0, b3_l]) for (dy = [0, b3_w]) {
        y_offset = (dy == 0) ? 2 : 0;
        translate([ b3_x + dx, y_origin + dy + y_offset, floor_thickness ])
            cylinder(d = b3_pin_d, h = b3_pin_h, $fn=24);
    }
    
    // Board 2 corner support pins
    for (dx = [0, b2_l]) for (dy = [0, b2_w]) {
        translate([ b2_x + dx, y_origin + dy, floor_thickness ])
            cylinder(d = b2_pin_d, h = b2_pin_h, $fn=24);
    }
    // Pi Zero printed standoffs
    for (m = pi_mounts) {
        translate([ pi_x + m[0], y_origin + m[1], floor_thickness ]) {
            difference() {
                cylinder(d = pi_standoff_outer_d, h = standoff_h/2, $fn=64);
                translate([0, 0, -1])
                    cylinder(d = pi_hole_d, h = standoff_h/2 + 2, $fn=64);
            }
        }
    }
    translate([ b3_x + b3_l/2, y_origin + 21, floor_thickness ]) {
        difference() {
            cylinder(d = extra_d, h = b3_pin_h, $fn=32);
            translate([0, 0, -1])
                cylinder(d = extra_hole_d, h = b3_pin_h + 2, $fn=32);
        }
   }

}
module lid() {
    difference() {
        union() {
            cube([box_x, box_y, floor_thickness], center=false);
            translate([wall_thickness, wall_thickness, -floor_thickness])
                cube([total_inner_x, total_inner_y, floor_thickness], center=false);
        }
//        xpos = [ wall_thickness + screw_mount_d/2, box_x - wall_thickness - screw_mount_d/2 ];
//        ypos = [ wall_thickness + screw_mount_d/2, box_y - wall_thickness - screw_mount_d/2 ];
//        for (x_ = xpos) for (y_ = ypos)
//            translate([x_, y_, -floor_thickness - 1])
//                cylinder(d = screw_hole_d + screw_hole_clearance,
//                         h = 2*floor_thickness + 2, $fn=32);
    }
}

// Final Assembly
base(); mounts_and_pins(); 
// To preview the lid:
//translate([0, 0, 0]) lid();
